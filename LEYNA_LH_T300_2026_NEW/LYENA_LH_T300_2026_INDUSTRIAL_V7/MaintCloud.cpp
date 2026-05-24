#include "MaintCloud.h"

#include <ArduinoJson.h>
#include <WiFiClientSecure.h>
#include <math.h>
#include <string.h>
#include <time.h>

#if defined(ARDUINO_ARCH_ESP8266)
#include <bearssl/bearssl.h>
#elif defined(ARDUINO_ARCH_ESP32)
#include <mbedtls/md.h>
#endif

#include "IndustrialApp.h"

namespace industrial_v2 {
namespace {

static constexpr unsigned long kMaintMinPollSeconds = 5UL;
static constexpr unsigned long kMaintDefaultPollSeconds = 15UL;
static constexpr unsigned long kMaintMaxPollSeconds = 3600UL;
static constexpr uint32_t kMaintClockRetryMs = 60000UL;
static constexpr uint32_t kMaintRequestTimeoutMs = 15000UL;
static constexpr time_t kMaintClockReadyEpoch = 1700000000;
const char* kMaintNtp1 = "pool.ntp.org";
const char* kMaintNtp2 = "time.google.com";
const char* kMaintNtp3 = "time.nist.gov";
const char* kMaintBootstrapAliasHost = "devicebootstrap.maintelligence.app";
const char* kMaintSyncAliasHost = "devicesync.maintelligence.app";
const char* kMaintDefaultBootstrapUrl = "https://us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceBootstrap";
const char* kMaintDefaultSyncUrl = "https://us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceSync";

bool gMaintTimeConfigured = false;
uint32_t gMaintLastTimeAttemptMs = 0;
WiFiClient gMaintHttpClient;
WiFiClientSecure gMaintHttpsClient;

String trimCopy(const String& value) {
  String copy = value;
  copy.trim();
  return copy;
}

void setCloudState(const String& status, const String& errorMessage = String()) {
  copyText(runtimeData.lastCloudStatus, status);
  copyText(runtimeData.lastCloudError, errorMessage);
}

bool clockReady() {
  return time(nullptr) > kMaintClockReadyEpoch;
}

void requestClockSyncIfNeeded() {
  const uint32_t now = millis();
  if (gMaintTimeConfigured && static_cast<uint32_t>(now - gMaintLastTimeAttemptMs) < kMaintClockRetryMs) return;

  configTime(0, 0, kMaintNtp1, kMaintNtp2, kMaintNtp3);
  gMaintTimeConfigured = true;
  gMaintLastTimeAttemptMs = now;
  addLog("NTP sync requested for cloud IoT");
}

bool ensureClockReady() {
  if (clockReady()) return true;
  requestClockSyncIfNeeded();
  setCloudState("waiting-time", "clock not synchronized");
  return false;
}

String unixTimeMsString() {
  const unsigned long long nowMs = static_cast<unsigned long long>(time(nullptr)) * 1000ULL;
  char buffer[24];
  snprintf(buffer, sizeof(buffer), "%llu", nowMs);
  return String(buffer);
}

String isoTimestampNow() {
  time_t now = time(nullptr);
  struct tm timeInfo;
  gmtime_r(&now, &timeInfo);
  char buffer[32];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &timeInfo);
  return String(buffer);
}

String bytesToHex(const uint8_t* input, size_t length) {
  static const char hex[] = "0123456789abcdef";
  String output;
  output.reserve(length * 2U);
  for (size_t index = 0; index < length; ++index) {
    output += hex[(input[index] >> 4) & 0x0F];
    output += hex[input[index] & 0x0F];
  }
  return output;
}

String hmacSha256Hex(const String& key, const String& message) {
#if defined(ARDUINO_ARCH_ESP8266)
  uint8_t digest[32];
  br_hmac_key_context keyContext;
  br_hmac_context context;
  br_hmac_key_init(&keyContext, &br_sha256_vtable, key.c_str(), key.length());
  br_hmac_init(&context, &keyContext, 32);
  br_hmac_update(&context, message.c_str(), message.length());
  br_hmac_out(&context, digest);
  return bytesToHex(digest, sizeof(digest));
#else
  uint8_t digest[32];
  mbedtls_md_context_t context;
  mbedtls_md_init(&context);
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (!info) {
    mbedtls_md_free(&context);
    return String();
  }
  if (mbedtls_md_setup(&context, info, 1) != 0) {
    mbedtls_md_free(&context);
    return String();
  }
  if (mbedtls_md_hmac_starts(&context, reinterpret_cast<const unsigned char*>(key.c_str()), key.length()) != 0 ||
      mbedtls_md_hmac_update(&context, reinterpret_cast<const unsigned char*>(message.c_str()), message.length()) != 0 ||
      mbedtls_md_hmac_finish(&context, digest) != 0) {
    mbedtls_md_free(&context);
    return String();
  }
  mbedtls_md_free(&context);
  return bytesToHex(digest, sizeof(digest));
#endif
}
void appendCapabilities(JsonArray capabilities) {
  String list = trimCopy(String(config().iotCapabilities));
  if (!list.length()) list = "temperature,humidity,setpoint,power,mode";

  int start = 0;
  while (start < list.length()) {
    int comma = list.indexOf(',', start);
    if (comma < 0) comma = list.length();
    String token = list.substring(start, comma);
    token.trim();
    token.toLowerCase();
    if (token.length()) capabilities.add(token);
    start = comma + 1;
  }
}

bool capabilityEnabled(const char* capability) {
  if (!capability || !capability[0]) return false;
  String target = trimCopy(String(capability));
  target.toLowerCase();

  String list = trimCopy(String(config().iotCapabilities));
  int start = 0;
  while (start < list.length()) {
    int comma = list.indexOf(',', start);
    if (comma < 0) comma = list.length();
    String token = list.substring(start, comma);
    token.trim();
    token.toLowerCase();
    if (token == target) return true;
    start = comma + 1;
  }
  return false;
}

void updatePollFromResponse(JsonVariantConst pollIntervalMs) {
  if (pollIntervalMs.isNull()) return;
  const unsigned long pollMs = pollIntervalMs.as<unsigned long>();
  if (pollMs < kMaintMinPollSeconds * 1000UL) return;

  unsigned long pollSeconds = pollMs / 1000UL;
  if (!pollSeconds) pollSeconds = kMaintDefaultPollSeconds;
  if (pollSeconds > kMaintMaxPollSeconds) pollSeconds = kMaintMaxPollSeconds;
  mutableConfig().iotPollSeconds = static_cast<uint16_t>(pollSeconds);
}

bool endpointLooksValid(const String& url, const char* expectedSuffix, const char* expectedHostAlias = nullptr) {
  const String trimmed = trimCopy(url);
  if (!trimmed.length()) return false;

  String normalized = trimmed;
  normalized.toLowerCase();

  if (expectedSuffix && expectedSuffix[0]) {
    String suffix = String(expectedSuffix);
    suffix.toLowerCase();
    if (normalized.endsWith(suffix)) return true;
  } else {
    return true;
  }

  if (expectedHostAlias && expectedHostAlias[0]) {
    const int schemeIndex = normalized.indexOf("://");
    const int hostStart = schemeIndex >= 0 ? schemeIndex + 3 : 0;
    int hostEnd = normalized.indexOf('/', hostStart);
    if (hostEnd < 0) hostEnd = normalized.length();
    String host = normalized.substring(hostStart, hostEnd);
    if (host == expectedHostAlias) return true;
  }

  return false;
}

String endpointComparable(const String& url) {
  String normalized = trimCopy(url);
  normalized.toLowerCase();
  if (normalized.startsWith("https://")) normalized.remove(0, 8);
  else if (normalized.startsWith("http://")) normalized.remove(0, 7);
  while (normalized.endsWith("/")) {
    normalized.remove(normalized.length() - 1);
  }
  return normalized;
}

bool sameEndpoint(const String& left, const String& right) {
  return endpointComparable(left) == endpointComparable(right);
}

bool shouldFallbackToDefault(const String& configuredUrl, const char* fallbackUrl, int httpCode) {
  if (!fallbackUrl || !fallbackUrl[0]) return false;
  if (sameEndpoint(configuredUrl, String(fallbackUrl))) return false;
  return httpCode == 404 || httpCode <= 0;
}

bool postJson(const String& url, const String& body, DynamicJsonDocument& responseDoc, int& httpCode, bool signRequest);

bool postJsonWithFallback(
    String& endpointUrl,
    const char* fallbackUrl,
    const String& body,
    DynamicJsonDocument& responseDoc,
    int& httpCode,
    bool signRequest,
    const char* logPrefix) {
  if (postJson(endpointUrl, body, responseDoc, httpCode, signRequest)) return true;
  if (!shouldFallbackToDefault(endpointUrl, fallbackUrl, httpCode)) return false;

  String fallback = String(fallbackUrl);
  addLog("Cloud IoT %s retrying with default URL: %s", logPrefix ? logPrefix : "request", fallback.c_str());
  responseDoc.clear();
  if (!postJson(fallback, body, responseDoc, httpCode, signRequest)) return false;

  endpointUrl = fallback;
  return true;
}

int relayIndexFromLabel(const String& label) {
  String normalized = trimCopy(label);
  normalized.toUpperCase();
  if (!normalized.startsWith("REL")) return -1;
  const int relayNumber = normalized.substring(3).toInt();
  if (relayNumber < 1 || relayNumber > static_cast<int>(kChannelCount)) return -1;
  return relayNumber - 1;
}

const char* workModeLabel(uint8_t mode) {
  switch (mode) {
    case WORK_THERMOSTAT: return "thermostat";
    case WORK_PUSHBUTTON: return "pushbutton";
    case WORK_MANUAL: return "manual";
    case WORK_CUSTOM: return "custom";
    default: return "disabled";
  }
}

bool parseWorkModeValue(JsonVariantConst input, uint8_t& outputMode) {
  if (input.is<uint8_t>() || input.is<uint16_t>() || input.is<int>() || input.is<long>()) {
    const long rawMode = input.as<long>();
    if (rawMode < WORK_DISABLED || rawMode > WORK_CUSTOM) return false;
    outputMode = static_cast<uint8_t>(rawMode);
    return true;
  }

  if (input.is<const char*>()) {
    String label = trimCopy(input.as<String>());
    label.toLowerCase();
    if (label == "disabled" || label == "disable" || label == "off" || label == "0") {
      outputMode = WORK_DISABLED;
      return true;
    }
    if (label == "thermostat" || label == "auto" || label == "1") {
      outputMode = WORK_THERMOSTAT;
      return true;
    }
    if (label == "pushbutton" || label == "push" || label == "2") {
      outputMode = WORK_PUSHBUTTON;
      return true;
    }
    if (label == "manual" || label == "3") {
      outputMode = WORK_MANUAL;
      return true;
    }
    if (label == "custom" || label == "program" || label == "4") {
      outputMode = WORK_CUSTOM;
      return true;
    }
  }
  return false;
}

uint8_t fallbackWorkModeWhenPowerOn() {
  const String customProgram = trimCopy(String(mutableConfig().customProgram));
  return customProgram.length() ? WORK_CUSTOM : WORK_THERMOSTAT;
}

void fillReportedState(JsonObject reportedState, const String& applyStatus, const String& applyMessage, long appliedDesiredVersion) {
  reportedState["readingAt"] = isoTimestampNow();
  reportedState["status"] = "online";
  reportedState["firmwareVersion"] = config().iotFirmwareVersion[0] ? config().iotFirmwareVersion : "lh-t300-v6";
  if (runtimeData.ipAddress[0]) reportedState["ipAddress"] = runtimeData.ipAddress;
  reportedState["uptimeSeconds"] = millis() / 1000UL;
  reportedState["setpoint"] = x10ToFloat(config().setpointX10);
  reportedState["power"] = config().workMode != WORK_DISABLED;
  reportedState["mode"] = config().coolingMode ? "cool" : "heat";
  reportedState["workMode"] = config().workMode;
  reportedState["workModeLabel"] = workModeLabel(config().workMode);
  reportedState["customProgramActive"] = config().workMode == WORK_CUSTOM;
  reportedState["customProgramValid"] = customProgramValidFlag();
  reportedState["customProgramRuleCount"] = customProgramCompiledCount();
  if (customProgramErrorText() && customProgramErrorText()[0]) reportedState["customProgramError"] = customProgramErrorText();
  else reportedState["customProgramError"] = nullptr;
  reportedState["customProgramMode"] = customProgramModeText();
  reportedState["sequenceValid"] = sequenceProgramValidFlag();
  reportedState["sequenceRunning"] = sequenceProgramRunningFlag();
  if (sequenceProgramNameText() && sequenceProgramNameText()[0]) reportedState["sequenceName"] = sequenceProgramNameText();
  else reportedState["sequenceName"] = nullptr;
  reportedState["sequenceState"] = sequenceProgramStateText();
  reportedState["sequenceCurrentStep"] = sequenceProgramCurrentStep();
  reportedState["sequenceCurrentLoop"] = sequenceProgramCurrentLoop();
  if (sequenceProgramErrorText() && sequenceProgramErrorText()[0]) reportedState["sequenceError"] = sequenceProgramErrorText();
  else reportedState["sequenceError"] = nullptr;
  if (sequenceProgramErrorLine()) reportedState["sequenceErrorLine"] = sequenceProgramErrorLine();
  else reportedState["sequenceErrorLine"] = nullptr;
  const float seqLastTemp = sequenceProgramLastTemperature();
  if (!isnan(seqLastTemp)) reportedState["sequenceLastTemp"] = seqLastTemp;
  else reportedState["sequenceLastTemp"] = nullptr;
  if (runtimeData.temperatureValid[0]) reportedState["temperature"] = runtimeData.temperature[0];
  if (runtimeData.temperatureValid[1]) reportedState["secondaryTemperature"] = runtimeData.temperature[1];
  if (runtimeData.temperatureValid[2]) reportedState["temp3"] = runtimeData.temperature[2];
  if (runtimeData.temperatureValid[3]) reportedState["temp4"] = runtimeData.temperature[3];
  if (runtimeData.humidityValid[0]) reportedState["humidity"] = runtimeData.humidity[0];
  if (capabilityEnabled("fan")) {
    if (config().relay2Mode == RELAY2_ALWAYS_ON) reportedState["fan"] = "continuous";
    else if (config().relay2Mode == RELAY2_DISABLED) reportedState["fan"] = "off";
    else reportedState["fan"] = "auto";
  }

  if (capabilityEnabled("relays")) {
    JsonObject relays = reportedState.createNestedObject("relays");
    for (size_t index = 0; index < kChannelCount; ++index) {
      relays[String("REL") + String(index + 1U)] = runtimeData.relayState[index];
    }
  }
  JsonObject virtualInputs = reportedState.createNestedObject("virtualInputs");
  for (size_t index = 0; index < kChannelCount; ++index) {
    virtualInputs[String("VIN") + String(index + 1U)] = runtimeData.virtualInputState[index];
  }
  JsonArray sequenceUsedRelays = reportedState.createNestedArray("sequenceUsedRelays");
  JsonArray sequenceReservedRelays = reportedState.createNestedArray("sequenceReservedRelays");
  const uint8_t usedMask = sequenceProgramUsedRelayMask();
  const uint8_t reservedMask = sequenceProgramReservedRelayMask();
  for (size_t index = 0; index < kChannelCount; ++index) {
    if ((usedMask & static_cast<uint8_t>(1U << index)) != 0U) {
      sequenceUsedRelays.add(String("REL") + String(index + 1U));
    }
    if ((reservedMask & static_cast<uint8_t>(1U << index)) != 0U) {
      sequenceReservedRelays.add(String("REL") + String(index + 1U));
    }
  }

  if (runtimeData.highAlarmActive || runtimeData.lowAlarmActive || runtimeData.defrosting) {
    JsonArray alarms = reportedState.createNestedArray("alarms");
    if (runtimeData.highAlarmActive) alarms.add("high_temp");
    if (runtimeData.lowAlarmActive) alarms.add("low_temp");
    if (runtimeData.defrosting) alarms.add("defrosting");
  }

  JsonObject raw = reportedState.createNestedObject("raw");
  if (runtimeData.temperatureValid[0]) raw["Temp1"] = String(runtimeData.temperature[0], 1);
  if (runtimeData.temperatureValid[1]) raw["Temp2"] = String(runtimeData.temperature[1], 1);
  if (runtimeData.temperatureValid[2]) raw["Temp3"] = String(runtimeData.temperature[2], 1);
  if (runtimeData.temperatureValid[3]) raw["Temp4"] = String(runtimeData.temperature[3], 1);
  if (runtimeData.humidityValid[0]) raw["Hum1"] = String(runtimeData.humidity[0], 1);
  raw["Set1"] = String(x10ToFloat(config().setpointX10), 1);
  for (size_t index = 0; index < kChannelCount; ++index) {
    raw[String("REL") + String(index + 1U)] = runtimeData.relayState[index] ? "1" : "0";
  }
  uint8_t alarmIndex = 0;
  if (runtimeData.highAlarmActive) raw[String("AL") + String(alarmIndex++)] = "high_temp";
  if (runtimeData.lowAlarmActive && alarmIndex < 9) raw[String("AL") + String(alarmIndex++)] = "low_temp";
  if (runtimeData.defrosting && alarmIndex < 9) raw[String("AL") + String(alarmIndex++)] = "defrosting";

  if (appliedDesiredVersion >= 0) {
    reportedState["appliedDesiredVersion"] = appliedDesiredVersion;
    if (applyStatus.length()) reportedState["applyStatus"] = applyStatus;
    if (applyMessage.length()) reportedState["applyMessage"] = applyMessage;
  }
}

bool postJson(const String& url, const String& body, DynamicJsonDocument& responseDoc, int& httpCode, bool signRequest) {
  responseDoc.clear();
  httpCode = -1;
  if (signRequest && !ensureClockReady()) return false;
  HTTPClient http;
  String responsePreview;
  const bool secure = url.startsWith("https://");
  addLog("Cloud IoT request start: secure=%s heap=%lu url=%s", secure ? "yes" : "no", static_cast<unsigned long>(appFreeHeap()), url.c_str());
  if (secure && !config().allowInsecureTls) {
    setCloudState("tls-blocked", "enable insecure TLS to reach the cloud endpoint");
    return false;
  }
  if (secure) {
    gMaintHttpsClient.stop();
    gMaintHttpsClient.setTimeout(kMaintRequestTimeoutMs);
    gMaintHttpsClient.setInsecure();
    if (!http.begin(gMaintHttpsClient, url)) {
      setCloudState("begin-failed", "http begin failed");
      return false;
    }
    addLog("Cloud IoT http.begin ok (https)");
  } else {
    gMaintHttpClient.stop();
    if (!http.begin(gMaintHttpClient, url)) {
      setCloudState("begin-failed", "http begin failed");
      return false;
    }
    addLog("Cloud IoT http.begin ok (http)");
  }
  http.setTimeout(kMaintRequestTimeoutMs);
  http.setReuse(false);
  http.addHeader("Content-Type", "application/json");
  addLog("Cloud IoT POST dispatch: %u bytes", static_cast<unsigned>(body.length()));
  if (signRequest) {
    const String timestamp = unixTimeMsString();
    const String signature = hmacSha256Hex(String(config().iotDeviceSecret), timestamp + "." + body);
    if (!signature.length()) {
      http.end();
      setCloudState("sign-error", "unable to compute HMAC");
      return false;
    }
    http.addHeader("x-maint-org-id", trimCopy(String(config().iotOrganizationId)));
    http.addHeader("x-maint-device-key", trimCopy(String(config().iotDeviceKey)));
    http.addHeader("x-maint-ts", timestamp);
    http.addHeader("x-maint-signature", signature);
  }
  httpCode = http.POST(body);
  addLog("Cloud IoT POST completed: code=%d", httpCode);

  bool parsedJson = false;
  WiFiClient* responseStream = http.getStreamPtr();
  if (responseStream) {
    const DeserializationError error = deserializeJson(responseDoc, *responseStream);
    if (!error) {
      parsedJson = true;
    } else {
      responseDoc.clear();
    }
  }

  if (!parsedJson) {
    responsePreview = http.getString();
    if (responsePreview.length() > 240) responsePreview = responsePreview.substring(0, 240) + "...";
    if (responsePreview.length()) {
      addLog("Cloud IoT non-JSON response preview: %s", responsePreview.c_str());
    }
  }

  http.end();
  runtimeData.lastCloudCode = httpCode > 0 ? static_cast<uint16_t>(httpCode) : 0U;
  runtimeData.lastCloudMillis = millis();
  if (httpCode <= 0) {
    const String driverMessage = HTTPClient::errorToString(httpCode);
    setCloudState("http-error", responsePreview.length() ? responsePreview : driverMessage);
    addLog("Cloud IoT HTTP error: %d (%s) url=%s", httpCode, driverMessage.c_str(), url.c_str());
    return false;
  }
  if (httpCode < 200 || httpCode >= 300) {
    String message;
    if (responseDoc["message"].is<const char*>()) message = responseDoc["message"].as<String>();
    if (!message.length() && responseDoc["error"].is<const char*>()) message = responseDoc["error"].as<String>();
    if (!message.length()) message = responsePreview;
    if (!message.length()) message = String("HTTP ") + httpCode;
    if (responsePreview.length()) {
      addLog("Cloud IoT API error body: %s", responsePreview.c_str());
    }
    setCloudState("api-error", message);
    addLog("Cloud IoT API error: HTTP %d", httpCode);
    return false;
  }
  setCloudState("online", String());
  return true;
}

bool applyDesiredState(JsonObjectConst desiredState, String& applyStatus, String& applyMessage, long& appliedVersion) {
  applyStatus = String();
  applyMessage = String();
  appliedVersion = -1;

  if (desiredState.isNull() || !desiredState.containsKey("version")) return false;

  appliedVersion = desiredState["version"].as<long>();
  if (appliedVersion < 0 || appliedVersion == config().iotLastDesiredVersion) return false;

  const uint8_t initialWorkMode = mutableConfig().workMode;
  bool configChanged = false;
  bool relayChanged = false;
  bool switchedToManual = false;
  bool fanChanged = false;
  bool virtualInputsChanged = false;
  bool virtualPulseTriggered = false;

  bool requestedWorkModeProvided = false;
  uint8_t requestedWorkMode = initialWorkMode;
  JsonVariantConst desiredWorkMode = desiredState["workMode"];
  if (!desiredWorkMode.isNull()) {
    if (parseWorkModeValue(desiredWorkMode, requestedWorkMode)) {
      requestedWorkModeProvided = true;
    } else {
      addLog("Cloud IoT desired state ignored invalid workMode");
    }
  } else {
    JsonVariantConst desiredControlProfile = desiredState["controlProfile"];
    if (!desiredControlProfile.isNull() && parseWorkModeValue(desiredControlProfile, requestedWorkMode)) {
      requestedWorkModeProvided = true;
    }
  }

  if (requestedWorkModeProvided && mutableConfig().workMode != requestedWorkMode) {
    mutableConfig().workMode = requestedWorkMode;
    configChanged = true;
  }

  if (desiredState.containsKey("customProgram") && !desiredState["customProgram"].isNull()) {
    const String nextCustomProgram = desiredState["customProgram"].as<String>();
    if (String(mutableConfig().customProgram) != nextCustomProgram) {
      copyText(mutableConfig().customProgram, nextCustomProgram);
      configChanged = true;
    }
  }

  if (desiredState.containsKey("setpoint") && !desiredState["setpoint"].isNull()) {
    const int16_t nextSetpoint = floatToX10(desiredState["setpoint"].as<float>());
    if (mutableConfig().setpointX10 != nextSetpoint) {
      mutableConfig().setpointX10 = nextSetpoint;
      configChanged = true;
    }
  }

  if (desiredState.containsKey("setpoint2") && !desiredState["setpoint2"].isNull()) {
    const int16_t nextSetpoint2 = floatToX10(desiredState["setpoint2"].as<float>());
    if (mutableConfig().setpoint2X10 != nextSetpoint2) {
      mutableConfig().setpoint2X10 = nextSetpoint2;
      configChanged = true;
    }
  }

  if (desiredState.containsKey("differentialX10") && !desiredState["differentialX10"].isNull()) {
    const int16_t nextDifferentialX10 = desiredState["differentialX10"].as<int16_t>();
    if (mutableConfig().differentialX10 != nextDifferentialX10) {
      mutableConfig().differentialX10 = nextDifferentialX10;
      configChanged = true;
    }
  }

  if (desiredState.containsKey("highAlarmX10") && !desiredState["highAlarmX10"].isNull()) {
    const int16_t nextHighAlarmX10 = desiredState["highAlarmX10"].as<int16_t>();
    if (mutableConfig().highAlarmX10 != nextHighAlarmX10) {
      mutableConfig().highAlarmX10 = nextHighAlarmX10;
      configChanged = true;
    }
  }

  if (desiredState.containsKey("lowAlarmX10") && !desiredState["lowAlarmX10"].isNull()) {
    const int16_t nextLowAlarmX10 = desiredState["lowAlarmX10"].as<int16_t>();
    if (mutableConfig().lowAlarmX10 != nextLowAlarmX10) {
      mutableConfig().lowAlarmX10 = nextLowAlarmX10;
      configChanged = true;
    }
  }

  if (desiredState.containsKey("tempAlarmDelayMin") && !desiredState["tempAlarmDelayMin"].isNull()) {
    const uint16_t nextTempAlarmDelayMin = desiredState["tempAlarmDelayMin"].as<uint16_t>();
    if (mutableConfig().tempAlarmDelayMin != nextTempAlarmDelayMin) {
      mutableConfig().tempAlarmDelayMin = nextTempAlarmDelayMin;
      configChanged = true;
    }
  }

  if (desiredState.containsKey("controlPeriodMs") && !desiredState["controlPeriodMs"].isNull()) {
    const uint16_t nextControlPeriodMs = desiredState["controlPeriodMs"].as<uint16_t>();
    if (mutableConfig().controlPeriodMs != nextControlPeriodMs) {
      mutableConfig().controlPeriodMs = nextControlPeriodMs;
      configChanged = true;
    }
  }

  if (desiredState.containsKey("defrostIntervalMin") && !desiredState["defrostIntervalMin"].isNull()) {
    const uint16_t nextDefrostIntervalMin = desiredState["defrostIntervalMin"].as<uint16_t>();
    if (mutableConfig().defrostIntervalMin != nextDefrostIntervalMin) {
      mutableConfig().defrostIntervalMin = nextDefrostIntervalMin;
      configChanged = true;
    }
  }

  if (desiredState.containsKey("defrostDurationMin") && !desiredState["defrostDurationMin"].isNull()) {
    const uint16_t nextDefrostDurationMin = desiredState["defrostDurationMin"].as<uint16_t>();
    if (mutableConfig().defrostDurationMin != nextDefrostDurationMin) {
      mutableConfig().defrostDurationMin = nextDefrostDurationMin;
      configChanged = true;
    }
  }

  if (desiredState.containsKey("defrostStopX10") && !desiredState["defrostStopX10"].isNull()) {
    const int16_t nextDefrostStopX10 = desiredState["defrostStopX10"].as<int16_t>();
    if (mutableConfig().defrostStopX10 != nextDefrostStopX10) {
      mutableConfig().defrostStopX10 = nextDefrostStopX10;
      configChanged = true;
    }
  }

  if (desiredState.containsKey("stopRelay1OnDefrost") && !desiredState["stopRelay1OnDefrost"].isNull()) {
    const bool nextStopRelay1OnDefrost = desiredState["stopRelay1OnDefrost"].as<bool>();
    if (mutableConfig().stopRelay1OnDefrost != nextStopRelay1OnDefrost) {
      mutableConfig().stopRelay1OnDefrost = nextStopRelay1OnDefrost;
      configChanged = true;
    }
  }

  if (desiredState.containsKey("stopRelay2OnDefrost") && !desiredState["stopRelay2OnDefrost"].isNull()) {
    const bool nextStopRelay2OnDefrost = desiredState["stopRelay2OnDefrost"].as<bool>();
    if (mutableConfig().stopRelay2OnDefrost != nextStopRelay2OnDefrost) {
      mutableConfig().stopRelay2OnDefrost = nextStopRelay2OnDefrost;
      configChanged = true;
    }
  }

  if (desiredState.containsKey("relay2Mode") && !desiredState["relay2Mode"].isNull()) {
    const uint8_t nextRelay2Mode = desiredState["relay2Mode"].as<uint8_t>();
    if (mutableConfig().relay2Mode != nextRelay2Mode) {
      mutableConfig().relay2Mode = nextRelay2Mode;
      configChanged = true;
    }
  }

  if (desiredState.containsKey("relay3Mode") && !desiredState["relay3Mode"].isNull()) {
    const uint8_t nextRelay3Mode = desiredState["relay3Mode"].as<uint8_t>();
    if (mutableConfig().relay3Mode != nextRelay3Mode) {
      mutableConfig().relay3Mode = nextRelay3Mode;
      configChanged = true;
    }
  }

  bool powerRequested = false;
  bool requestedPowerOn = true;
  if (desiredState.containsKey("power") && !desiredState["power"].isNull()) {
    powerRequested = true;
    requestedPowerOn = desiredState["power"].as<bool>();
    if (!requestedPowerOn) {
      if (mutableConfig().workMode != WORK_DISABLED) {
        mutableConfig().workMode = WORK_DISABLED;
        configChanged = true;
      }
      for (size_t index = 0; index < kChannelCount; ++index) {
        runtimeData.manualRelayState[index] = false;
        runtimeData.relayState[index] = false;
      }
    } else if (mutableConfig().workMode == WORK_DISABLED && !requestedWorkModeProvided) {
      const uint8_t resumeMode = initialWorkMode == WORK_DISABLED ? fallbackWorkModeWhenPowerOn() : initialWorkMode;
      if (mutableConfig().workMode != resumeMode) {
        mutableConfig().workMode = resumeMode;
        configChanged = true;
      }
    }
  }

  if (desiredState.containsKey("mode") && !desiredState["mode"].isNull()) {
    String requestedMode = desiredState["mode"].as<String>();
    requestedMode.toLowerCase();
    if (requestedMode == "cool" || requestedMode == "cooling") {
      if (!mutableConfig().coolingMode) {
        mutableConfig().coolingMode = true;
        configChanged = true;
      }
    } else if (requestedMode == "heat" || requestedMode == "heating") {
      if (mutableConfig().coolingMode) {
        mutableConfig().coolingMode = false;
        configChanged = true;
      }
    }
  }

  if (desiredState.containsKey("fan") && !desiredState["fan"].isNull()) {
    String requestedFan = desiredState["fan"].as<String>();
    requestedFan.toLowerCase();
    uint8_t nextRelay2Mode = mutableConfig().relay2Mode;
    if (requestedFan == "continuous" || requestedFan == "on") {
      nextRelay2Mode = RELAY2_ALWAYS_ON;
    } else if (requestedFan == "auto") {
      nextRelay2Mode = RELAY2_FOLLOW_RELAY1;
    } else if (requestedFan == "off") {
      nextRelay2Mode = RELAY2_DISABLED;
    }
    if (nextRelay2Mode != mutableConfig().relay2Mode) {
      mutableConfig().relay2Mode = nextRelay2Mode;
      configChanged = true;
      fanChanged = true;
    }
  }

  JsonObjectConst relayObject = desiredState["relays"].as<JsonObjectConst>();
  if ((!powerRequested || requestedPowerOn) && !relayObject.isNull() && relayObject.size() > 0) {
    for (JsonPairConst relayPair : relayObject) {
      const int relayIndex = relayIndexFromLabel(String(relayPair.key().c_str()));
      if (relayIndex < 0) continue;
      const bool nextState = relayPair.value().as<bool>();
      if (runtimeData.manualRelayState[relayIndex] != nextState) {
        runtimeData.manualRelayState[relayIndex] = nextState;
        relayChanged = true;
      }
    }

    if (relayChanged && mutableConfig().workMode != WORK_MANUAL) {
      mutableConfig().workMode = WORK_MANUAL;
      configChanged = true;
      switchedToManual = true;
    }
  }

  if (desiredState.containsKey("pulseVirtualInput") && !desiredState["pulseVirtualInput"].isNull()) {
    const String pulseInput = desiredState["pulseVirtualInput"].as<String>();
    if (pulseVirtualInputByLabel(pulseInput)) {
      virtualPulseTriggered = true;
    } else {
      addLog("Cloud IoT desired state ignored invalid pulseVirtualInput: %s", pulseInput.c_str());
    }
  }

  JsonObjectConst virtualInputObject = desiredState["virtualInputs"].as<JsonObjectConst>();
  if (!virtualInputObject.isNull() && virtualInputObject.size() > 0) {
    for (JsonPairConst virtualPair : virtualInputObject) {
      const String vinLabel = String(virtualPair.key().c_str());
      const bool nextState = virtualPair.value().as<bool>();
      if (setVirtualInputByLabel(vinLabel, nextState)) {
        virtualInputsChanged = true;
      } else {
        addLog("Cloud IoT desired state ignored invalid virtual input key: %s", vinLabel.c_str());
      }
    }
  }

  sanitizeConfig(mutableConfig());
  mutableConfig().iotLastDesiredVersion = appliedVersion;
  saveConfigToFile();

  if (relayChanged && mutableConfig().workMode == WORK_MANUAL) {
    for (size_t index = 0; index < kChannelCount; ++index) {
      runtimeData.relayState[index] = runtimeData.manualRelayState[index];
    }
  }

  applyStatus = "applied";
  if (relayChanged && switchedToManual && fanChanged) {
    applyMessage = "Desired state applied. Relay control moved to manual mode and fan mapped to relay2 mode.";
  } else if (relayChanged && switchedToManual) {
    applyMessage = "Desired state applied. Relay control moved to manual mode.";
  } else if (fanChanged) {
    applyMessage = "Desired state applied. Fan mapped to relay2 mode.";
  } else if (virtualPulseTriggered && virtualInputsChanged) {
    applyMessage = "Desired state applied. Virtual input pulse and state updated.";
  } else if (virtualPulseTriggered) {
    applyMessage = "Desired state applied. Virtual input pulse triggered.";
  } else if (virtualInputsChanged) {
    applyMessage = "Desired state applied. Virtual input state updated.";
  } else if (configChanged || relayChanged) {
    applyMessage = "Desired state applied locally.";
  } else {
    applyMessage = "Desired version confirmed without further changes.";
  }

  addLog("Cloud IoT desired state applied: version %ld", appliedVersion);
  return true;
}

bool bootstrapDevice() {
  const String organizationId = trimCopy(String(config().iotOrganizationId));
  const String assetId = trimCopy(String(config().iotAssetId));
  const String deviceKey = trimCopy(String(config().iotDeviceKey));
  const String bootstrapToken = trimCopy(String(config().iotBootstrapToken));
  const String bootstrapUrl = trimCopy(String(config().iotBootstrapUrl));
  String activeBootstrapUrl = bootstrapUrl;
  if (!organizationId.length() || !bootstrapToken.length() || !bootstrapUrl.length() || (!assetId.length() && !deviceKey.length())) {
    setCloudState("config-miss", "missing bootstrap fields");
    return false;
  }
  if (!endpointLooksValid(bootstrapUrl, "/iotDeviceBootstrap", kMaintBootstrapAliasHost)) {
    setCloudState("config-error", "bootstrapUrl must end with /iotDeviceBootstrap (e.g. https://us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceBootstrap)");
    addLog("Cloud IoT configuration error: invalid bootstrapUrl %s", bootstrapUrl.c_str());
    return false;
  }
  DynamicJsonDocument payloadDoc(1024);
  payloadDoc["organizationId"] = organizationId;
  if (assetId.length()) payloadDoc["assetId"] = assetId;
  if (deviceKey.length()) payloadDoc["deviceKey"] = deviceKey;
  payloadDoc["bootstrapToken"] = bootstrapToken;
  payloadDoc["firmwareVersion"] = config().iotFirmwareVersion[0] ? config().iotFirmwareVersion : "lh-t300-v6";
  JsonArray capabilities = payloadDoc.createNestedArray("capabilities");
  appendCapabilities(capabilities);
  String payload;
  serializeJson(payloadDoc, payload);
  DynamicJsonDocument responseDoc(2048);
  int httpCode = 0;
  setCloudState("bootstrap", String());
  if (!postJsonWithFallback(activeBootstrapUrl, kMaintDefaultBootstrapUrl, payload, responseDoc, httpCode, false, "bootstrap")) {
    return false;
  }
  const bool bootstrapUrlUpdated = !sameEndpoint(activeBootstrapUrl, bootstrapUrl);
  if (bootstrapUrlUpdated) {
    copyText(mutableConfig().iotBootstrapUrl, activeBootstrapUrl);
    addLog("Cloud IoT bootstrap URL switched to default long endpoint");
  }
  if (responseDoc["assetId"].is<const char*>()) {
    copyText(mutableConfig().iotAssetId, responseDoc["assetId"].as<String>());
  }
  if (responseDoc["deviceKey"].is<const char*>()) {
    copyText(mutableConfig().iotDeviceKey, responseDoc["deviceKey"].as<String>());
  }
  copyText(mutableConfig().iotDeviceSecret, responseDoc["deviceSecret"] | String(config().iotDeviceSecret));
  if (responseDoc["syncUrl"].is<const char*>()) {
    copyText(mutableConfig().iotSyncUrl, responseDoc["syncUrl"].as<String>());
  }
  mutableConfig().iotBootstrapDone = mutableConfig().iotDeviceSecret[0] != '\0';
  updatePollFromResponse(responseDoc["pollIntervalMs"].as<JsonVariantConst>());
  if (mutableConfig().iotBootstrapDone) {
    mutableConfig().iotBootstrapToken[0] = '\0';
    mutableConfig().iotLastDesiredVersion = -1;
    saveConfigToFile();
    setCloudState("bootstrapped", String());
    addLog("Cloud IoT bootstrap completed for %s", mutableConfig().iotDeviceKey);
    return true;
  }
  setCloudState("bootstrap-error", "bootstrap response missing device secret");
  if (bootstrapUrlUpdated) saveConfigToFile();
  addLog("Cloud IoT bootstrap failed for %s", mutableConfig().iotDeviceKey);
  return false;
}

bool syncDevice() {
  if (!config().iotBootstrapDone || !config().iotDeviceSecret[0]) {
    setCloudState("bootstrap-req", "device secret missing");
    return false;
  }

  const String syncUrl = trimCopy(String(config().iotSyncUrl));
  String activeSyncUrl = syncUrl;
  if (!syncUrl.length()) {
    setCloudState("config-miss", "missing sync URL");
    return false;
  }
  if (!endpointLooksValid(syncUrl, "/iotDeviceSync", kMaintSyncAliasHost)) {
    setCloudState("config-error", "syncUrl must end with /iotDeviceSync (e.g. https://us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceSync)");
    addLog("Cloud IoT configuration error: invalid syncUrl %s", syncUrl.c_str());
    return false;
  }

  DynamicJsonDocument payloadDoc(4608);
  JsonObject reportedState = payloadDoc.createNestedObject("reportedState");
  fillReportedState(reportedState, String(), String(), -1);
  JsonArray capabilities = payloadDoc.createNestedArray("capabilities");
  appendCapabilities(capabilities);
  payloadDoc["storeTelemetry"] = config().iotStoreTelemetry;

  String payload;
  serializeJson(payloadDoc, payload);

  DynamicJsonDocument responseDoc(3072);
  int httpCode = 0;
  if (!postJsonWithFallback(activeSyncUrl, kMaintDefaultSyncUrl, payload, responseDoc, httpCode, true, "sync")) {
    return false;
  }
  const bool syncUrlUpdated = !sameEndpoint(activeSyncUrl, syncUrl);
  if (syncUrlUpdated) {
    copyText(mutableConfig().iotSyncUrl, activeSyncUrl);
    saveConfigToFile();
    addLog("Cloud IoT sync URL switched to default long endpoint");
  }

  updatePollFromResponse(responseDoc["pollIntervalMs"].as<JsonVariantConst>());

  String applyStatus;
  String applyMessage;
  long appliedVersion = -1;
  const bool applied = applyDesiredState(responseDoc["desiredState"].as<JsonObjectConst>(), applyStatus, applyMessage, appliedVersion);
  if (!applied) {
    setCloudState("online", String());
    return true;
  }

  payloadDoc.clear();
  JsonObject reportedAfterApply = payloadDoc.createNestedObject("reportedState");
  fillReportedState(reportedAfterApply, applyStatus, applyMessage, appliedVersion);
  JsonArray capabilitiesAfterApply = payloadDoc.createNestedArray("capabilities");
  appendCapabilities(capabilitiesAfterApply);
  payloadDoc["storeTelemetry"] = config().iotStoreTelemetry;
  payload.clear();
  serializeJson(payloadDoc, payload);

  responseDoc.clear();
  httpCode = 0;
  if (!postJsonWithFallback(activeSyncUrl, kMaintDefaultSyncUrl, payload, responseDoc, httpCode, true, "sync-confirm")) {
    return false;
  }

  updatePollFromResponse(responseDoc["pollIntervalMs"].as<JsonVariantConst>());
  setCloudState("online", String());
  return true;
}

}  // namespace

bool iotCloudConfigured() {
  if (!config().iotOrganizationId[0]) return false;
  if (!config().iotBootstrapDone && !config().iotAssetId[0] && !config().iotDeviceKey[0]) return false;
  if (config().iotBootstrapDone && !config().iotDeviceKey[0]) return false;
  if (config().iotBootstrapDone) return config().iotSyncUrl[0] && config().iotDeviceSecret[0];
  return config().iotBootstrapToken[0] && config().iotBootstrapUrl[0];
}

unsigned long iotCloudIntervalMs() {
  const unsigned long pollSeconds = config().iotPollSeconds ? config().iotPollSeconds : kMaintDefaultPollSeconds;
  return pollSeconds * 1000UL;
}

bool processIotCloud() {
  if (WiFi.status() != WL_CONNECTED) {
    setCloudState("waiting-wifi", String());
    return false;
  }

  if (!config().iotBootstrapDone) return bootstrapDevice();
  return syncDevice();
}

}  // namespace industrial_v2
