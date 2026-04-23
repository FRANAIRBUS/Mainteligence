#include "IndustrialApp.h"

#include <ArduinoJson.h>
#include <DHT.h>
#include <DallasTemperature.h>
#include <OneWire.h>
#include <WiFiClientSecure.h>
#include <ArduinoOTA.h>
#include <DNSServer.h>
#if APP_HAS_MODBUS_RTU
#include <ModbusRTU.h>
#endif
#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#if defined(ARDUINO_ARCH_ESP32)
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#endif

#include "LogBuffer.h"
#include "MaintCloud.h"
#include "WebUi.h"

namespace industrial_v2 {

AppWebServer server;
AppRuntimeData runtimeData;
ModbusIP modbusIp;
#if APP_HAS_MODBUS_RTU
ModbusRTU modbusRtu;
#endif

namespace {

static constexpr char kConfigFile[] = "/lh_v4_config.json";
static constexpr uint32_t kSystemDriverMs = 250U;
static constexpr uint32_t kSensorDriverMs = 200U;
static constexpr uint32_t kAlarmBlinkOnMs = 400U;
static constexpr uint32_t kAlarmBlinkOffMs = 1000U;
static constexpr float kReferenceVoltage = 3.3f;
static constexpr float kReferenceResistor = 10000.0f;
static constexpr float kPtcEsp32RawGain = 1.81f;
static constexpr float kNominalResistance = 10000.0f;
static constexpr float kNominalTemperature = 25.0f;
static constexpr float kBeta = 3950.0f;
static constexpr size_t kConfigJsonCapacity = 8192U;
static constexpr uint32_t kWifiRetryMs = 10000U;
static constexpr uint16_t kCaptiveDnsPort = 53U;
#if APP_HAS_MODBUS_RTU
#if defined(ARDUINO_ARCH_ESP32)
static constexpr int16_t kModbusRtuFixedRxPin = 16;
static constexpr int16_t kModbusRtuFixedTxPin = 17;
static constexpr int16_t kModbusRtuFixedDePin = 4;
#else
static constexpr int16_t kModbusRtuFixedRxPin = -1;
static constexpr int16_t kModbusRtuFixedTxPin = -1;
static constexpr int16_t kModbusRtuFixedDePin = -1;
#endif
#endif

struct SystemTaskData { uint32_t runs = 0; };
struct SensorTaskData { uint32_t runs = 0; };
struct ControlTaskData { uint32_t runs = 0; };
struct TelemetryTaskData { uint32_t runs = 0; };
struct CloudTaskData { uint32_t runs = 0; };
struct ModbusTaskData { uint32_t runs = 0; };

void startConfigTask();
void processConfigTask();
void endConfigTask();
void startSystemTask();
void processSystemTask();
void endSystemTask();
void startSensorTask();
void processSensorTask();
void endSensorTask();
void startControlTask();
void processControlTask();
void endControlTask();
void startTelemetryTask();
void processTelemetryTask();
void endTelemetryTask();
void startCloudTask();
void processCloudTask();
void endCloudTask();
void startModbusTask();
void processModbusTask();
void endModbusTask();
bool telemetryConfigured();
bool cloudConfigured();
bool postTelemetryJson(const String& endpoint);
bool postTelemetryForm(const String& endpoint);
unsigned long currentTelemetryIntervalMs();
unsigned long currentCloudIntervalMs();
void updateTelemetryIntervalFromConfig();
void updateCloudIntervalFromConfig();
String telemetryStatusLabel();
String cloudStatusLabel();
bool wifiCredentialsConfigured();
String provisioningSsid();
void startProvisioningAccessPoint();
void stopProvisioningAccessPoint();
void startWifiStationIfNeeded(uint32_t now);
void requestConnectivityReload();
void applyConnectivityReloadIfNeeded(uint32_t now);
void manageConnectivity(uint32_t now);
void ensureServerStarted();
void ensureOtaReady();
void startCaptiveDns(const IPAddress& apIp);
void stopCaptiveDns();
void applyCommissioningSafeDefaults(AppConfigData& appConfig);
bool connectivityConfigurationChanged(const AppConfigData& previous, const AppConfigData& next);
bool ioConfigurationChanged(const AppConfigData& previous, const AppConfigData& next);
bool sensorConfigurationChanged(const AppConfigData& previous, const AppConfigData& next);
bool modbusConfigurationChanged(const AppConfigData& previous, const AppConfigData& next);
void armOperationalRuntime();
#if defined(ARDUINO_ARCH_ESP32)
void ensureCloudWorkerStarted();
void cloudWorkerTask(void* parameter);
#endif

EdgeDriver<AppConfigData> configDriver(startConfigTask, processConfigTask, endConfigTask);
EdgeDriver<SystemTaskData> systemDriver(startSystemTask, processSystemTask, endSystemTask);
EdgeDriver<SensorTaskData> sensorDriver(startSensorTask, processSensorTask, endSensorTask);
EdgeDriver<ControlTaskData> controlDriver(startControlTask, processControlTask, endControlTask);
EdgeDriver<TelemetryTaskData> telemetryDriver(startTelemetryTask, processTelemetryTask, endTelemetryTask);
EdgeDriver<CloudTaskData> cloudDriver(startCloudTask, processCloudTask, endCloudTask);
EdgeDriver<ModbusTaskData> modbusDriver(startModbusTask, processModbusTask, endModbusTask);

OneWire* gOneWire[kChannelCount] = {nullptr, nullptr, nullptr, nullptr};
DallasTemperature* gDallas[kChannelCount] = {nullptr, nullptr, nullptr, nullptr};
DHT* gDht[kChannelCount] = {nullptr, nullptr, nullptr, nullptr};
bool gDsPending[kChannelCount] = {false, false, false, false};
uint32_t gDsRequestedAt[kChannelCount] = {0, 0, 0, 0};
uint32_t gLastSensorSampleAt[kChannelCount] = {0, 0, 0, 0};
bool gPtcFilterReady[kChannelCount] = {false, false, false, false};
float gPtcFilteredRaw[kChannelCount] = {0.0f, 0.0f, 0.0f, 0.0f};
bool gLastInputRaw[kChannelCount] = {false, false, false, false};
uint32_t gLastInputChangeAt[kChannelCount] = {0, 0, 0, 0};
bool gMdnsStarted = false;
bool gDnsStarted = false;
bool gAlarmBlinkState = false;
uint32_t gAlarmBlinkAt = 0;
uint32_t gHighAlarmConditionAt = 0;
uint32_t gLowAlarmConditionAt = 0;
bool gHasStoredConfig = false;
bool gServerStarted = false;
bool gOtaStarted = false;
bool gWifiConnectInProgress = false;
bool gConnectivityReloadRequested = false;
bool gOperationalRuntimeArmed = false;
bool gModbusServerConfigured = false;
uint32_t gWifiConnectStartedAt = 0;
WiFiClient gTelemetryHttpClient;
WiFiClientSecure gTelemetryHttpsClient;
uint32_t gLastWifiAttemptAt = 0;
DNSServer gDnsServer;
#if APP_HAS_MODBUS_RTU
IPAddress gModbusBridgeClientIp;
uint16_t gModbusBridgeTransactionId = 0;
uint8_t gModbusBridgeSlaveId = 0;
uint8_t gModbusBridgeFunction = 0;
Modbus::ResultCode gModbusLastRtuEvent = Modbus::EX_SUCCESS;
bool gMirrorSetpointTracked = false;
int16_t gMirrorSetpointX10 = 0;
#endif
#if defined(ARDUINO_ARCH_ESP32)
static constexpr uint32_t kCloudWorkerStackSize = 12288U;
TaskHandle_t gCloudWorkerHandle = nullptr;
portMUX_TYPE gLogBufferMux = portMUX_INITIALIZER_UNLOCKED;
#endif

const char* workModeLabel(uint8_t mode) {
  switch (mode) {
    case WORK_THERMOSTAT: return "thermostat";
    case WORK_PUSHBUTTON: return "pushbutton";
    case WORK_MANUAL: return "manual";
    default: return "disabled";
  }
}

const char* modbusModeLabel(uint8_t mode) {
  switch (mode) {
    case MODBUS_RTU_SERVER: return "rtu-server";
    case MODBUS_TCP_SERVER: return "tcp-server";
    case MODBUS_TCP_TO_RTU: return "tcp-to-rtu";
    case MODBUS_SLAVE_TO_ME: return "slave-to-me";
    case MODBUS_SLAVE_TO_ME_HYBRID_TCP: return "slave-to-me-hybrid-tcp";
    default: return "off";
  }
}

bool modbusModeUsesTcp(uint8_t mode) {
  return mode == MODBUS_TCP_SERVER || mode == MODBUS_TCP_TO_RTU || mode == MODBUS_SLAVE_TO_ME_HYBRID_TCP;
}

bool modbusModeSupported(uint8_t mode) {
#if APP_HAS_MODBUS_RTU
  return mode <= MODBUS_SLAVE_TO_ME_HYBRID_TCP;
#else
  return mode == MODBUS_OFF || mode == MODBUS_TCP_SERVER;
#endif
}

bool modbusMirrorModeActive() {
  if (!gHasStoredConfig || !config().enableModbus) return false;
  return config().modbusMode == MODBUS_SLAVE_TO_ME || config().modbusMode == MODBUS_SLAVE_TO_ME_HYBRID_TCP;
}

bool modbusMirrorHybridMapActive() {
  return gHasStoredConfig && config().enableModbus && config().modbusMode == MODBUS_SLAVE_TO_ME_HYBRID_TCP;
}

uint16_t modbusMirrorTempSourceRegister(size_t index) {
  if (index >= kChannelCount) return 0;
  return modbusMirrorHybridMapActive() ? config().modbusMirrorTempRegisters[index] : config().modbusTempRegisters[index];
}

uint16_t modbusMirrorHumSourceRegister(size_t index) {
  if (index >= kHumidityChannelCount) return 0;
  return modbusMirrorHybridMapActive() ? config().modbusMirrorHumRegisters[index] : config().modbusHumRegisters[index];
}

uint16_t modbusMirrorRelaySourceRegister(size_t index) {
  if (index >= kChannelCount) return 0;
  return modbusMirrorHybridMapActive() ? config().modbusMirrorRelayRegisters[index] : config().modbusRelayRegisters[index];
}

uint16_t modbusMirrorSetpointSourceRegister() {
  if (!modbusMirrorHybridMapActive()) return config().modbusSetpointRegister;
  return config().modbusMirrorSetpointRegister ? config().modbusMirrorSetpointRegister : config().modbusSetpointRegister;
}

uint16_t modbusMirrorStatusSourceRegister() {
  if (!modbusMirrorHybridMapActive()) return config().modbusStatusRegister;
  return config().modbusMirrorStatusRegister ? config().modbusMirrorStatusRegister : config().modbusStatusRegister;
}

uint8_t modbusMirrorScale() {
  return config().modbusScale ? config().modbusScale : 10U;
}

uint8_t modbusPublishScale() {
  const uint8_t fallbackScale = modbusMirrorScale();
  const uint8_t mode = config().modbusMode;
  if (mode == MODBUS_TCP_SERVER || mode == MODBUS_TCP_TO_RTU || mode == MODBUS_SLAVE_TO_ME_HYBRID_TCP) {
    return config().modbusTcpScale ? config().modbusTcpScale : fallbackScale;
  }
  return fallbackScale;
}

float readInternalTemperature() {
#if APP_HAS_INTERNAL_TEMP
  return temperatureRead();
#else
  return NAN;
#endif
}

bool pressedLevel() {
  return config().inputPullup ? false : true;
}

void setRuntimeText(char* dst, size_t length, const String& value) {
  if (!length) return;
  strlcpy(dst, value.c_str(), length);
}

void setModbusStatus(const String& value) {
  setRuntimeText(runtimeData.lastModbusStatus, sizeof(runtimeData.lastModbusStatus), value);
}

template <typename T, size_t N>
bool arrayEquals(const T (&lhs)[N], const T (&rhs)[N]) {
  return memcmp(lhs, rhs, sizeof(lhs)) == 0;
}

void startCaptiveDns(const IPAddress& apIp) {
  if (gDnsStarted) return;
  gDnsServer.start(kCaptiveDnsPort, "*", apIp);
  gDnsStarted = true;
  addLog("Captive DNS started on %s", apIp.toString().c_str());
}

void stopCaptiveDns() {
  if (!gDnsStarted) return;
  gDnsServer.stop();
  gDnsStarted = false;
  addLog("Captive DNS stopped");
}

void applyCommissioningSafeDefaults(AppConfigData& appConfig) {
  appConfig.workMode = WORK_DISABLED;
  appConfig.enableTelemetry = false;
  appConfig.enableModbus = false;
  for (size_t index = 0; index < kChannelCount; ++index) {
    appConfig.sensorTypes[index] = SENSOR_NONE;
  }
}

bool connectivityConfigurationChanged(const AppConfigData& previous, const AppConfigData& next) {
  return strcmp(previous.hostName, next.hostName) != 0 ||
         strcmp(previous.wifiSsid, next.wifiSsid) != 0 ||
         strcmp(previous.wifiPass, next.wifiPass) != 0 ||
         strcmp(previous.apPassword, next.apPassword) != 0 ||
         strcmp(previous.otaPassword, next.otaPassword) != 0 ||
         previous.wifiUseDhcp != next.wifiUseDhcp ||
         strcmp(previous.wifiStaticIp, next.wifiStaticIp) != 0 ||
         strcmp(previous.wifiSubnetMask, next.wifiSubnetMask) != 0 ||
         strcmp(previous.wifiGateway, next.wifiGateway) != 0 ||
         strcmp(previous.wifiDns1, next.wifiDns1) != 0 ||
         strcmp(previous.wifiDns2, next.wifiDns2) != 0 ||
         previous.keepApEnabled != next.keepApEnabled ||
         previous.enableMdns != next.enableMdns ||
         previous.enableOta != next.enableOta ||
         previous.wifiConnectTimeoutSec != next.wifiConnectTimeoutSec;
}

bool ioConfigurationChanged(const AppConfigData& previous, const AppConfigData& next) {
  return previous.relayActiveHigh != next.relayActiveHigh ||
         previous.inputPullup != next.inputPullup ||
         previous.inputDebounceMs != next.inputDebounceMs ||
         !arrayEquals(previous.inputPins, next.inputPins) ||
         !arrayEquals(previous.relayPins, next.relayPins);
}

bool sensorConfigurationChanged(const AppConfigData& previous, const AppConfigData& next) {
  return previous.sensorPeriodMs != next.sensorPeriodMs ||
         previous.ds18b20WaitMs != next.ds18b20WaitMs ||
         previous.analogAverageSamples != next.analogAverageSamples ||
         !arrayEquals(previous.sensorPins, next.sensorPins) ||
         !arrayEquals(previous.sensorTypes, next.sensorTypes) ||
         !arrayEquals(previous.sensorTempCalibrationX10, next.sensorTempCalibrationX10) ||
         !arrayEquals(previous.sensorHumCalibrationX10, next.sensorHumCalibrationX10);
}

bool modbusConfigurationChanged(const AppConfigData& previous, const AppConfigData& next) {
  return previous.enableModbus != next.enableModbus ||
         previous.modbusMode != next.modbusMode ||
         previous.modbusPort != next.modbusPort ||
         previous.modbusTaskMs != next.modbusTaskMs ||
         previous.modbusScale != next.modbusScale ||
         previous.modbusTcpScale != next.modbusTcpScale ||
         previous.modbusUnitId != next.modbusUnitId ||
         previous.modbusRemoteUnitId != next.modbusRemoteUnitId ||
         previous.modbusRtuBaud != next.modbusRtuBaud ||
         previous.modbusSetpointRegister != next.modbusSetpointRegister ||
         previous.modbusMirrorSetpointRegister != next.modbusMirrorSetpointRegister ||
         previous.modbusStatusRegister != next.modbusStatusRegister ||
         previous.modbusMirrorStatusRegister != next.modbusMirrorStatusRegister ||
         !arrayEquals(previous.modbusTempRegisters, next.modbusTempRegisters) ||
         !arrayEquals(previous.modbusMirrorTempRegisters, next.modbusMirrorTempRegisters) ||
         !arrayEquals(previous.modbusHumRegisters, next.modbusHumRegisters) ||
         !arrayEquals(previous.modbusMirrorHumRegisters, next.modbusMirrorHumRegisters) ||
         !arrayEquals(previous.modbusRelayRegisters, next.modbusRelayRegisters) ||
         !arrayEquals(previous.modbusMirrorRelayRegisters, next.modbusMirrorRelayRegisters);
}

bool wifiCredentialsConfigured() {
  return config().wifiSsid[0] != '\0';
}

bool parseIpv4Text(const char* text, IPAddress& address) {
  return text && text[0] && address.fromString(text);
}

bool validateStaticWifiConfig(const AppConfigData& appConfig, String& errorMessage) {
  if (appConfig.wifiUseDhcp) return true;

  IPAddress localIp;
  IPAddress subnet;
  IPAddress gateway;
  IPAddress dns1;
  IPAddress dns2;
  if (!parseIpv4Text(appConfig.wifiStaticIp, localIp)) {
    errorMessage = "invalid static IP";
    return false;
  }
  if (!parseIpv4Text(appConfig.wifiSubnetMask, subnet)) {
    errorMessage = "invalid subnet mask";
    return false;
  }
  if (!parseIpv4Text(appConfig.wifiGateway, gateway)) {
    errorMessage = "invalid gateway";
    return false;
  }
  if (!parseIpv4Text(appConfig.wifiDns1, dns1)) {
    errorMessage = "invalid primary DNS";
    return false;
  }
  if (!parseIpv4Text(appConfig.wifiDns2, dns2)) {
    errorMessage = "invalid secondary DNS";
    return false;
  }
  if (localIp[3] == 0 || localIp[3] == 255) {
    errorMessage = "static IP host cannot end in .0 or .255";
    return false;
  }
  return true;
}

void configureWifiStationNetwork() {
  const IPAddress zeroIp(0, 0, 0, 0);
  if (config().wifiUseDhcp) {
    WiFi.config(zeroIp, zeroIp, zeroIp, zeroIp, zeroIp);
    addLog("WiFi network mode: DHCP");
    return;
  }

  IPAddress localIp;
  IPAddress subnet;
  IPAddress gateway;
  IPAddress dns1;
  IPAddress dns2;
  if (!parseIpv4Text(config().wifiStaticIp, localIp) ||
      !parseIpv4Text(config().wifiSubnetMask, subnet) ||
      !parseIpv4Text(config().wifiGateway, gateway) ||
      !parseIpv4Text(config().wifiDns1, dns1) ||
      !parseIpv4Text(config().wifiDns2, dns2) ||
      localIp[3] == 0 || localIp[3] == 255) {
    WiFi.config(zeroIp, zeroIp, zeroIp, zeroIp, zeroIp);
    addLog("WiFi static invalid -> DHCP");
    return;
  }

  if (WiFi.config(localIp, gateway, subnet, dns1, dns2)) {
    addLog("WiFi network mode: static %s gateway %s", localIp.toString().c_str(), gateway.toString().c_str());
  } else {
    WiFi.config(zeroIp, zeroIp, zeroIp, zeroIp, zeroIp);
    addLog("WiFi static apply fail -> DHCP");
  }
}

String provisioningSsid() {
  String suffix = String(appChipId(), HEX);
  suffix.toUpperCase();
  while (suffix.length() < 6) suffix = String("0") + suffix;
  return String(config().hostName) + "-" + suffix;
}

void ensureServerStarted() {
  if (gServerStarted) return;
  server.begin();
  gServerStarted = true;
  addLog("HTTP server started");
}

void stopProvisioningAccessPoint() {
  if (!runtimeData.apModeActive && !gDnsStarted) return;
  stopCaptiveDns();
  if (runtimeData.apModeActive) WiFi.softAPdisconnect(true);
  runtimeData.apModeActive = false;
  runtimeData.apSsid[0] = '\0';
  addLog("Provisioning AP stopped");
}

void startProvisioningAccessPoint() {
  if (runtimeData.apModeActive) return;

  const bool hasStaCredentials = wifiCredentialsConfigured();
  WiFi.mode(hasStaCredentials ? WIFI_AP_STA : WIFI_AP);
  IPAddress apIp(192, 168, 4, 1);
  IPAddress gateway(192, 168, 4, 1);
  IPAddress subnet(255, 255, 255, 0);
  WiFi.softAPConfig(apIp, gateway, subnet);

  const String ssid = provisioningSsid();
  const char* password = config().apPassword[0] ? config().apPassword : "12345678";
  if (!WiFi.softAP(ssid.c_str(), password)) {
    addLog("AP start failed");
    return;
  }

  runtimeData.apModeActive = true;
  copyText(runtimeData.apSsid, ssid);
  startCaptiveDns(apIp);
  if (WiFi.status() != WL_CONNECTED) {
    setRuntimeText(runtimeData.ipAddress, sizeof(runtimeData.ipAddress), WiFi.softAPIP().toString());
  }
  addLog("Provisioning AP started: %s", runtimeData.apSsid);
}

void startWifiStationIfNeeded(uint32_t now) {
  if (!wifiCredentialsConfigured()) return;
  if (WiFi.status() == WL_CONNECTED) return;

  const uint32_t connectTimeoutMs = static_cast<uint32_t>(config().wifiConnectTimeoutSec) * 1000UL;
  if (gWifiConnectInProgress && static_cast<uint32_t>(now - gWifiConnectStartedAt) < connectTimeoutMs) return;
  if (gLastWifiAttemptAt && static_cast<uint32_t>(now - gLastWifiAttemptAt) < kWifiRetryMs) return;

  appSetHostName(config().hostName);
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.mode(runtimeData.apModeActive || config().keepApEnabled ? WIFI_AP_STA : WIFI_STA);
  configureWifiStationNetwork();
  WiFi.begin(config().wifiSsid, config().wifiPass);

  gWifiConnectInProgress = true;
  gWifiConnectStartedAt = now;
  gLastWifiAttemptAt = now;
  copyText(runtimeData.connectedSsid, String(config().wifiSsid));
  addLog("WiFi connection started: %s", config().wifiSsid);
}

void requestConnectivityReload() {
  gConnectivityReloadRequested = true;
}

void applyConnectivityReloadIfNeeded(uint32_t now) {
  if (!gConnectivityReloadRequested) return;

  gConnectivityReloadRequested = false;
  if (gMdnsStarted) {
    MDNS.end();
    gMdnsStarted = false;
  }

  runtimeData.wifiConnected = false;
  runtimeData.wifiRssi = 0;
  runtimeData.ipAddress[0] = '\0';
  runtimeData.connectedSsid[0] = '\0';
  runtimeData.otaActive = false;
  gOtaStarted = false;
  gWifiConnectInProgress = false;
  gWifiConnectStartedAt = 0;
  gLastWifiAttemptAt = 0;

  stopProvisioningAccessPoint();
  WiFi.disconnect();
  WiFi.mode(WIFI_OFF);

  if (wifiCredentialsConfigured()) {
    if (config().keepApEnabled) startProvisioningAccessPoint();
    startWifiStationIfNeeded(now);
  } else {
    startProvisioningAccessPoint();
  }

  addLog("Connectivity stack reloaded");
}

void manageConnectivity(uint32_t now) {
  runtimeData.wifiHasCredentials = wifiCredentialsConfigured();
  applyConnectivityReloadIfNeeded(now);

  if (WiFi.status() == WL_CONNECTED) {
    gWifiConnectInProgress = false;
    if (!config().keepApEnabled) stopProvisioningAccessPoint();
  } else if (runtimeData.wifiHasCredentials) {
    startWifiStationIfNeeded(now);
    const uint32_t connectTimeoutMs = static_cast<uint32_t>(config().wifiConnectTimeoutSec) * 1000UL;
    if (!runtimeData.apModeActive && gWifiConnectStartedAt && static_cast<uint32_t>(now - gWifiConnectStartedAt) >= connectTimeoutMs) {
      startProvisioningAccessPoint();
    }
  } else {
    startProvisioningAccessPoint();
  }
}

void ensureOtaReady() {
  if (!config().enableOta || WiFi.status() != WL_CONNECTED) {
    runtimeData.otaActive = false;
    return;
  }
  if (gOtaStarted) {
    runtimeData.otaActive = true;
    return;
  }

  ArduinoOTA.setHostname(config().hostName);
  const char* password = config().otaPassword[0] ? config().otaPassword : config().adminPass;
  if (password[0]) ArduinoOTA.setPassword(password);
  ArduinoOTA.onStart([]() { addLog("OTA update started"); });
  ArduinoOTA.onEnd([]() { addLog("OTA update finished"); });
  ArduinoOTA.onError([](ota_error_t error) { addLog("OTA error: %u", static_cast<unsigned>(error)); });
  ArduinoOTA.begin();
  gOtaStarted = true;
  runtimeData.otaActive = true;
  addLog("OTA ready on %s", config().hostName);
}

void logInternal(const char* buffer) {
  Serial.println(buffer);
#if defined(ARDUINO_ARCH_ESP32)
  portENTER_CRITICAL(&gLogBufferMux);
  gLogBuffer.add(buffer);
  portEXIT_CRITICAL(&gLogBufferMux);
#else
  gLogBuffer.add(buffer);
#endif
}

void writeRelayHardware(size_t index, bool on) {
  const uint8_t pin = config().relayPins[index];
  runtimeData.relayState[index] = on;
  const bool driveHigh = config().relayActiveHigh ? on : !on;
  digitalWrite(pin, driveHigh ? HIGH : LOW);
}

void setAllRelaysOff() {
  for (size_t index = 0; index < kChannelCount; ++index) {
    writeRelayHardware(index, false);
  }
}

bool readInputHardware(size_t index) {
  return digitalRead(config().inputPins[index]) == HIGH;
}

void startMdnsIfNeeded() {
  if (!config().enableMdns || WiFi.status() != WL_CONNECTED) return;
  if (gMdnsStarted) return;
  if (MDNS.begin(config().hostName)) {
    MDNS.addService("http", "tcp", 80);
    gMdnsStarted = true;
    addLog("mDNS started at %s.local", config().hostName);
  } else {
    addLog("mDNS failed for %s", config().hostName);
  }
}

void clearSensorObjects() {
  for (size_t index = 0; index < kChannelCount; ++index) {
    delete gDallas[index];
    delete gOneWire[index];
    delete gDht[index];
    gDallas[index] = nullptr;
    gOneWire[index] = nullptr;
    gDht[index] = nullptr;
    gDsPending[index] = false;
    gDsRequestedAt[index] = 0;
    gLastSensorSampleAt[index] = 0;
    gPtcFilterReady[index] = false;
    gPtcFilteredRaw[index] = 0.0f;
  }
}

void initSensorObjects() {
  clearSensorObjects();
  for (size_t index = 0; index < kChannelCount; ++index) {
    runtimeData.temperature[index] = NAN;
    runtimeData.humidity[index] = NAN;
    runtimeData.temperatureValid[index] = false;
    runtimeData.humidityValid[index] = false;

    const uint8_t sensorType = config().sensorTypes[index];
    const uint8_t pin = config().sensorPins[index];
    if (sensorType == SENSOR_DS18B20) {
      gOneWire[index] = new OneWire(pin);
      gDallas[index] = new DallasTemperature(gOneWire[index]);
      gDallas[index]->begin();
      gDallas[index]->setWaitForConversion(false);
    } else if (sensorType == SENSOR_DHT11) {
      gDht[index] = new DHT(pin, DHT11);
      gDht[index]->begin();
    } else if (sensorType == SENSOR_DHT22) {
      gDht[index] = new DHT(pin, DHT22);
      gDht[index]->begin();
    }
  }
}

void configurePins() {
  if (!gHasStoredConfig) {
    addLog("Boot: IO deferred");
    return;
  }

#if defined(ARDUINO_ARCH_ESP32)
  analogReadResolution(12);
#endif

  for (size_t index = 0; index < kChannelCount; ++index) {
    pinMode(config().relayPins[index], OUTPUT);
    writeRelayHardware(index, false);
    if (config().inputPullup) pinMode(config().inputPins[index], INPUT_PULLUP);
    else pinMode(config().inputPins[index], INPUT);
#if defined(ARDUINO_ARCH_ESP32)
    if (config().sensorTypes[index] == SENSOR_NTC ||
        config().sensorTypes[index] == SENSOR_PTC ||
        config().sensorTypes[index] == SENSOR_PT100) {
      analogSetPinAttenuation(config().sensorPins[index], ADC_11db);
    }
#endif
    gLastInputRaw[index] = readInputHardware(index);
    gLastInputChangeAt[index] = millis();
    runtimeData.inputState[index] = gLastInputRaw[index];
    runtimeData.manualRelayState[index] = false;
  }
}

float readAnalogAverage(uint8_t pin) {
  uint32_t total = 0;
  const uint8_t samples = config().analogAverageSamples;
  for (uint8_t sample = 0; sample < samples; ++sample) {
    total += analogRead(pin);
    delayMicroseconds(250);
  }
  return static_cast<float>(total) / static_cast<float>(samples);
}

float readAnalogTrimmedAverage(uint8_t pin, uint8_t minimumSamples) {
  uint8_t samples = config().analogAverageSamples;
  if (samples < minimumSamples) samples = minimumSamples;
  if (samples < 3) return readAnalogAverage(pin);

  uint32_t total = 0;
  uint16_t minValue = 0xFFFFU;
  uint16_t maxValue = 0U;
  for (uint8_t sample = 0; sample < samples; ++sample) {
    const uint16_t value = static_cast<uint16_t>(analogRead(pin));
    total += value;
    if (value < minValue) minValue = value;
    if (value > maxValue) maxValue = value;
    delayMicroseconds(300);
  }

  total -= minValue;
  total -= maxValue;
  return static_cast<float>(total) / static_cast<float>(samples - 2U);
}

float smoothPtcRaw(size_t index, float raw) {
  if (index >= kChannelCount || isnan(raw)) return raw;
  if (!gPtcFilterReady[index]) {
    gPtcFilterReady[index] = true;
    gPtcFilteredRaw[index] = raw;
    return raw;
  }

  constexpr float kAlpha = 0.22f;
  gPtcFilteredRaw[index] += (raw - gPtcFilteredRaw[index]) * kAlpha;
  return gPtcFilteredRaw[index];
}

float dividerResistanceFromRaw(float raw) {
  const float rawMax = static_cast<float>(appAnalogMax());
  if (raw <= 0.0f || raw >= rawMax) return NAN;
  return kReferenceResistor * raw / (rawMax - raw);
}

float convertNtc(float raw) {
  const float resistance = dividerResistanceFromRaw(raw);
  if (isnan(resistance)) return NAN;
  const float steinhart = logf(resistance / kNominalResistance) / kBeta + (1.0f / (kNominalTemperature + 273.15f));
  const float tempC = (1.0f / steinhart) - 273.15f;
  return (tempC < -80.0f || tempC > 200.0f) ? NAN : tempC;
}

struct PtcPoint {
  float tempC;
  float ohms;
};

// Typical curve for silicon PTC around 1k at 25 C (KTY81-110 class).
// Divider assumed: pull-up 10k to 3.3V, sensor to GND.
static constexpr PtcPoint kPtcTable[] = {
  {-55.0f,  490.0f},
  {-50.0f,  515.0f},
  {-40.0f,  567.5f},
  {-30.0f,  623.5f},
  {-20.0f,  683.5f},
  {-10.0f,  747.5f},
  {  0.0f,  815.0f},
  { 10.0f,  886.0f},
  { 20.0f,  961.0f},
  { 25.0f, 1000.0f},
  { 30.0f, 1040.0f},
  { 40.0f, 1122.5f},
  { 50.0f, 1208.5f},
  { 60.0f, 1298.5f},
  { 70.0f, 1392.5f},
  { 80.0f, 1490.0f},
  { 90.0f, 1591.0f},
  {100.0f, 1696.0f},
  {110.0f, 1803.5f},
  {120.0f, 1908.5f},
  {125.0f, 1957.5f},
  {130.0f, 2004.0f},
  {140.0f, 2083.0f},
  {150.0f, 2140.0f},
};

static float ptcTempFromResistance(float resistance) {
  if (isnan(resistance)) return NAN;

  constexpr size_t n = sizeof(kPtcTable) / sizeof(kPtcTable[0]);
  if (resistance < kPtcTable[0].ohms || resistance > kPtcTable[n - 1].ohms) {
    return NAN;
  }

  for (size_t i = 1; i < n; ++i) {
    const float r0 = kPtcTable[i - 1].ohms;
    const float r1 = kPtcTable[i].ohms;

    if (resistance <= r1) {
      const float t0 = kPtcTable[i - 1].tempC;
      const float t1 = kPtcTable[i].tempC;
      const float ratio = (resistance - r0) / (r1 - r0);
      return t0 + ratio * (t1 - t0);
    }
  }

  return NAN;
}

float convertPtcFromResistance(float resistance) {
  const float tempC = ptcTempFromResistance(resistance);
  return (tempC < -55.0f || tempC > 150.0f) ? NAN : tempC;
}

float convertPtc(float raw) {
  const float rawMax = static_cast<float>(appAnalogMax());
  if (raw <= 0.0f || raw >= rawMax) return NAN;

#if defined(ARDUINO_ARCH_ESP32)
  float compensatedRaw = raw * kPtcEsp32RawGain;
  if (compensatedRaw >= rawMax) compensatedRaw = rawMax - 1.0f;
  const float compensatedTemp = convertPtcFromResistance(dividerResistanceFromRaw(compensatedRaw));
  if (!isnan(compensatedTemp)) return compensatedTemp;
#endif

  return convertPtcFromResistance(dividerResistanceFromRaw(raw));
}




float convertPt100(float raw) {
  const float rawMax = static_cast<float>(appAnalogMax());
  if (raw <= 0.0f || raw >= rawMax) return NAN;
  const float voltage = raw * (kReferenceVoltage / rawMax);
  if (voltage <= 0.0f || voltage >= kReferenceVoltage) return NAN;
  const float resistance = kReferenceResistor * (voltage / (kReferenceVoltage - voltage));
  const float tempC = (resistance - 100.0f) / 0.385f;
  return (tempC < -200.0f || tempC > 600.0f) ? NAN : tempC;
}

void setSensorValues(size_t index, float temp, bool tempValid, float hum, bool humValid) {
  runtimeData.temperature[index] = temp;
  runtimeData.humidity[index] = hum;
  runtimeData.temperatureValid[index] = tempValid;
  runtimeData.humidityValid[index] = humValid;
}

bool elapsedSince(uint32_t now, uint32_t last, uint32_t interval) {
  return static_cast<uint32_t>(now - last) >= interval;
}

bool reachedDeadline(uint32_t now, uint32_t deadline) {
  return static_cast<int32_t>(now - deadline) >= 0;
}

void processInputDebounce(uint32_t now) {
  for (size_t index = 0; index < kChannelCount; ++index) {
    const bool raw = readInputHardware(index);
    if (raw != gLastInputRaw[index]) {
      gLastInputRaw[index] = raw;
      gLastInputChangeAt[index] = now;
    }

    if (!elapsedSince(now, gLastInputChangeAt[index], config().inputDebounceMs)) continue;
    if (runtimeData.inputState[index] == raw) continue;

    const bool previous = runtimeData.inputState[index];
    runtimeData.inputState[index] = raw;

    if (config().workMode == WORK_PUSHBUTTON && raw == pressedLevel() && previous != raw) {
      runtimeData.manualRelayState[index] = !runtimeData.manualRelayState[index];
      addLog("Pushbutton ch%u -> relay %u %s", static_cast<unsigned>(index + 1U), static_cast<unsigned>(index + 1U), runtimeData.manualRelayState[index] ? "ON" : "OFF");
    }
  }
}

bool saveConfigDocument(const AppConfigData& appConfig) {
  if (!appBeginFilesystem()) {
    addLog("FS mount fail saving cfg");
    return false;
  }

  DynamicJsonDocument doc(kConfigJsonCapacity);
  serializeConfig(doc.to<JsonObject>(), appConfig);
  if (doc.overflowed()) {
    addLog("Cfg JSON overflow");
    return false;
  }
  File file = APP_FILESYSTEM.open(kConfigFile, "w");
  if (!file) {
    addLog("Unable to open %s for write", kConfigFile);
    return false;
  }

  const size_t written = serializeJson(doc, file);
  file.flush();
  const size_t fileSize = file.size();
  file.close();
  if (!written || !fileSize) {
    addLog("Cfg write 0 bytes");
    return false;
  }
  if (!APP_FILESYSTEM.exists(kConfigFile)) {
    addLog("Cfg missing after write: %s", kConfigFile);
    return false;
  }

  File verifyFile = APP_FILESYSTEM.open(kConfigFile, "r");
  if (!verifyFile) {
    addLog("Reopen %s failed", kConfigFile);
    return false;
  }
  DynamicJsonDocument verifyDoc(kConfigJsonCapacity);
  const DeserializationError verifyError = deserializeJson(verifyDoc, verifyFile);
  verifyFile.close();
  if (verifyError) {
    addLog("Cfg verify parse err: %s", verifyError.c_str());
    return false;
  }

  addLog("Config persisted: %u bytes", static_cast<unsigned>(fileSize));
  return true;
}

bool loadConfigDocument(AppConfigData& appConfig) {
  if (!appBeginFilesystem()) {
    addLog("FS mount fail loading cfg");
    return false;
  }

  if (!APP_FILESYSTEM.exists(kConfigFile)) {
    addLog("Cfg %s missing, defaults", kConfigFile);
    return false;
  }

  File file = APP_FILESYSTEM.open(kConfigFile, "r");
  if (!file) {
    addLog("Unable to open %s for read", kConfigFile);
    return false;
  }

  DynamicJsonDocument doc(kConfigJsonCapacity);
  const DeserializationError error = deserializeJson(doc, file);
  file.close();
  if (error) {
    addLog("Config parse error: %s", error.c_str());
    return false;
  }

  deserializeConfig(doc.as<JsonObjectConst>(), appConfig);
  return true;
}

bool urlIsHttps(const String& value) {
  return value.startsWith("https://");
}

String urlEncode(const String& value) {
  String out;
  out.reserve(value.length() * 3U);
  static const char hex[] = "0123456789ABCDEF";

  for (size_t index = 0; index < value.length(); ++index) {
    const unsigned char c = static_cast<unsigned char>(value[index]);
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~') {
      out += static_cast<char>(c);
    } else if (c == ' ') {
      out += '+';
    } else {
      out += '%';
      out += hex[(c >> 4) & 0x0F];
      out += hex[c & 0x0F];
    }
  }
  return out;
}

bool telemetryConfigured() {
  if (!config().enableTelemetry) return false;
  switch (config().telemetryMode) {
    case TELEMETRY_JSON:
    case TELEMETRY_LEGACY_FORM:
      return config().telemetryEndpoint[0] != '\0';
    default:
      return false;
  }
}

bool cloudConfigured() {
  return config().enableCloudIot && iotCloudConfigured();
}

unsigned long currentTelemetryIntervalMs() {
  const unsigned long telemetryPeriodSec = config().telemetryPeriodSec ? config().telemetryPeriodSec : 30UL;
  return telemetryPeriodSec * 1000UL;
}

unsigned long currentCloudIntervalMs() {
  return iotCloudIntervalMs();
}

void updateTelemetryIntervalFromConfig() {
  telemetryDriver.setEdgeInterval(currentTelemetryIntervalMs());
}

void updateCloudIntervalFromConfig() {
  cloudDriver.setEdgeInterval(currentCloudIntervalMs());
}

#if defined(ARDUINO_ARCH_ESP32)
void ensureCloudWorkerStarted() {
  if (gCloudWorkerHandle) return;

  TaskHandle_t workerHandle = nullptr;
  const BaseType_t created = xTaskCreatePinnedToCore(
      cloudWorkerTask,
      "cloud_iot",
      kCloudWorkerStackSize,
      nullptr,
      1,
      &workerHandle,
      0);
  if (created != pdPASS || !workerHandle) {
    runtimeData.cloudBusy = false;
    runtimeData.cloudWorkerStackHighWater = 0;
    copyText(runtimeData.lastCloudStatus, String("task-error"));
    copyText(runtimeData.lastCloudError, String("unable to create cloud worker"));
    addLog("Cloud worker create fail");
    return;
  }

  gCloudWorkerHandle = workerHandle;
  addLog("Cloud worker ready");
}

void cloudWorkerTask(void* parameter) {
  (void)parameter;
  for (;;) {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);

    const uint32_t stackHeadroom = static_cast<uint32_t>(uxTaskGetStackHighWaterMark(nullptr)) * sizeof(StackType_t);
    if (!runtimeData.cloudWorkerStackHighWater || stackHeadroom < runtimeData.cloudWorkerStackHighWater) {
      runtimeData.cloudWorkerStackHighWater = stackHeadroom;
    }

    processIotCloud();
    runtimeData.cloudBusy = false;
  }
}
#endif

String telemetryStatusLabel() {
  if (!config().enableTelemetry || config().telemetryMode == TELEMETRY_OFF) {
    return "disabled";
  }
  if (!telemetryConfigured()) return "config-missing";
  if (!runtimeData.wifiConnected) return "waiting-wifi";
  if (!runtimeData.lastTelemetryStatus[0]) return "idle";
  return String(runtimeData.lastTelemetryStatus);
}

String cloudStatusLabel() {
  if (!config().enableCloudIot) return "disabled";
  if (!cloudConfigured()) return "config-missing";
  if (!runtimeData.wifiConnected) return "waiting-wifi";
  if (!runtimeData.lastCloudStatus[0]) return "idle";
  return String(runtimeData.lastCloudStatus);
}

void updateRuntimeNetwork(uint32_t now) {
  const bool connected = WiFi.status() == WL_CONNECTED;
  const bool previous = runtimeData.wifiConnected;

  runtimeData.wifiConnected = connected;
  if (connected) {
    runtimeData.lastWifiOkMillis = now;
    runtimeData.wifiRssi = WiFi.RSSI();
    setRuntimeText(runtimeData.ipAddress, sizeof(runtimeData.ipAddress), WiFi.localIP().toString());
    setRuntimeText(runtimeData.connectedSsid, sizeof(runtimeData.connectedSsid), WiFi.SSID());
    if (!previous) {
      addLog("WiFi connected: %s RSSI %ld", runtimeData.ipAddress, static_cast<long>(runtimeData.wifiRssi));
      startMdnsIfNeeded();
    }
  } else {
    runtimeData.wifiRssi = 0;
    runtimeData.connectedSsid[0] = '\0';
    if (runtimeData.apModeActive) setRuntimeText(runtimeData.ipAddress, sizeof(runtimeData.ipAddress), WiFi.softAPIP().toString());
    else runtimeData.ipAddress[0] = '\0';
    if (previous) {
      addLog("WiFi disconnected");
      if (gMdnsStarted) {
        MDNS.end();
        gMdnsStarted = false;
      }
    }
  }

  runtimeData.otaActive = gOtaStarted && connected;
}

void maybeRestartForSchedule(uint32_t now) {
  if (runtimeData.pendingRestartAtMillis && reachedDeadline(now, runtimeData.pendingRestartAtMillis)) {
    delay(50);
    ESP.restart();
  }

  const uint32_t restartWindow = static_cast<uint32_t>(config().scheduledRestartHours) * 3600000UL;
  if (!restartWindow) return;
  if (!elapsedSince(now, runtimeData.bootMillis, restartWindow)) return;
  if (config().resetIfWifiMissing && runtimeData.wifiConnected) return;

  scheduleRestart(config().resetIfWifiMissing ? "sched wifi missing" : "scheduled restart", 1000U);
}

void handleAlarmOutput(uint32_t now) {
  if (config().relay3Mode != RELAY3_ALARM) return;

  const bool alarm = runtimeData.highAlarmActive || runtimeData.lowAlarmActive;
  if (!alarm) {
    gAlarmBlinkState = false;
    writeRelayHardware(2, false);
    return;
  }

  const uint32_t interval = gAlarmBlinkState ? kAlarmBlinkOnMs : kAlarmBlinkOffMs;
  if (elapsedSince(now, gAlarmBlinkAt, interval)) {
    gAlarmBlinkAt = now;
    gAlarmBlinkState = !gAlarmBlinkState;
  }
  writeRelayHardware(2, gAlarmBlinkState);
}

bool thermostatDemandFromSensor(bool previousState, bool coolingMode, float temperature, float setpoint, float differential) {
  if (coolingMode) {
    if (!previousState && temperature >= setpoint + differential) return true;
    if (previousState && temperature <= setpoint) return false;
  } else {
    if (!previousState && temperature <= setpoint - differential) return true;
    if (previousState && temperature >= setpoint) return false;
  }
  return previousState;
}

void applyThermostatMode(uint32_t now) {
  const bool temp1Valid = runtimeData.temperatureValid[0];
  const bool temp2Valid = runtimeData.temperatureValid[1];
  const float temp1 = runtimeData.temperature[0];
  const float temp2 = runtimeData.temperature[1];
  const float setpoint = x10ToFloat(config().setpointX10);
  const float setpoint2 = x10ToFloat(config().setpoint2X10);
  const float diff = x10ToFloat(config().differentialX10);
  const float highAlarm = x10ToFloat(config().highAlarmX10);
  const float lowAlarm = x10ToFloat(config().lowAlarmX10);
  const float defrostStop = x10ToFloat(config().defrostStopX10);
  const uint32_t alarmDelayMs = static_cast<uint32_t>(config().tempAlarmDelayMin) * 60000UL;

  const bool highAlarmCondition = temp1Valid && temp1 >= highAlarm;
  const bool lowAlarmCondition = temp1Valid && temp1 <= lowAlarm;

  if (!highAlarmCondition) {
    gHighAlarmConditionAt = 0;
    runtimeData.highAlarmActive = false;
  } else if (!alarmDelayMs) {
    runtimeData.highAlarmActive = true;
  } else {
    if (!gHighAlarmConditionAt) gHighAlarmConditionAt = now;
    runtimeData.highAlarmActive = elapsedSince(now, gHighAlarmConditionAt, alarmDelayMs);
  }

  if (!lowAlarmCondition) {
    gLowAlarmConditionAt = 0;
    runtimeData.lowAlarmActive = false;
  } else if (!alarmDelayMs) {
    runtimeData.lowAlarmActive = true;
  } else {
    if (!gLowAlarmConditionAt) gLowAlarmConditionAt = now;
    runtimeData.lowAlarmActive = elapsedSince(now, gLowAlarmConditionAt, alarmDelayMs);
  }

  bool relay1 = runtimeData.relayState[0];
  bool relay2 = runtimeData.relayState[1];
  bool relay3 = false;
  const bool relay4 = runtimeData.manualRelayState[3];

  if (!temp1Valid) {
    runtimeData.defrosting = false;
    setAllRelaysOff();
    writeRelayHardware(3, relay4);
    return;
  }

  const uint32_t defrostIntervalMs = static_cast<uint32_t>(config().defrostIntervalMin) * 60000UL;
  const uint32_t defrostDurationMs = static_cast<uint32_t>(config().defrostDurationMin) * 60000UL;

  if (config().relay3Mode == RELAY3_DEFROST && defrostIntervalMs && defrostDurationMs) {
    if (!runtimeData.defrosting && elapsedSince(now, runtimeData.lastDefrostCycleMillis, defrostIntervalMs)) {
      runtimeData.defrosting = true;
      runtimeData.lastDefrostCycleMillis = now;
      runtimeData.lastDefrostStartMillis = now;
      addLog("Defrost cycle started");
    }

    if (runtimeData.defrosting) {
      const bool stopByTemp = temp2Valid && temp2 >= defrostStop;
      const bool stopByTime = elapsedSince(now, runtimeData.lastDefrostStartMillis, defrostDurationMs);
      if (stopByTemp || stopByTime) {
        runtimeData.defrosting = false;
        runtimeData.lastDefrostCycleMillis = now;
        addLog("Defrost cycle ended (%s)", stopByTemp ? "temperature" : "time");
      }
    }
  } else {
    runtimeData.defrosting = false;
  }

  relay1 = thermostatDemandFromSensor(relay1, config().coolingMode, temp1, setpoint, diff);

  switch (config().relay2Mode) {
    case RELAY2_ALWAYS_ON:
      relay2 = true;
      break;
    case RELAY2_FOLLOW_RELAY1:
      relay2 = relay1;
      break;
    case RELAY2_FOLLOW_SETPOINT2:
      if (temp2Valid) relay2 = thermostatDemandFromSensor(relay2, config().coolingMode, temp2, setpoint2, diff);
      else relay2 = false;
      break;
    default:
      relay2 = false;
      break;
  }

  if (runtimeData.defrosting) {
    if (config().stopRelay1OnDefrost) relay1 = false;
    if (config().stopRelay2OnDefrost) relay2 = false;
    relay3 = config().relay3Mode == RELAY3_DEFROST;
  }

  writeRelayHardware(0, relay1);
  writeRelayHardware(1, relay2);
  writeRelayHardware(2, relay3);
  writeRelayHardware(3, relay4);
}

void applyPushbuttonMode() {
  for (size_t index = 0; index < kChannelCount; ++index) {
    writeRelayHardware(index, runtimeData.manualRelayState[index]);
  }
}

void applyManualMode() {
  for (size_t index = 0; index < kChannelCount; ++index) {
    writeRelayHardware(index, runtimeData.manualRelayState[index]);
  }
}

void sampleSensorChannel(size_t index, uint32_t now) {
  const uint8_t sensorType = config().sensorTypes[index];
  const uint8_t pin = config().sensorPins[index];
  const uint32_t minPeriod = sensorType == SENSOR_DHT11 || sensorType == SENSOR_DHT22 ? ((config().sensorPeriodMs > 2200U) ? config().sensorPeriodMs : 2200U) : config().sensorPeriodMs;

  if (!elapsedSince(now, gLastSensorSampleAt[index], minPeriod) && !(sensorType == SENSOR_DS18B20 && gDsPending[index])) {
    return;
  }

  float temp = runtimeData.temperature[index];
  float hum = runtimeData.humidity[index];
  bool tempValid = false;
  bool humValid = false;

  switch (sensorType) {
    case SENSOR_NONE:
      temp = NAN;
      hum = NAN;
      break;

    case SENSOR_DS18B20:
      if (!gDallas[index]) break;
      if (!gDsPending[index]) {
        gDallas[index]->requestTemperatures();
        gDsPending[index] = true;
        gDsRequestedAt[index] = now;
        gLastSensorSampleAt[index] = now;
        return;
      }
      if (!elapsedSince(now, gDsRequestedAt[index], config().ds18b20WaitMs)) return;
      temp = gDallas[index]->getTempCByIndex(0);
      tempValid = temp != DEVICE_DISCONNECTED_C && temp > -100.0f && temp < 200.0f;
      gDsPending[index] = false;
      gLastSensorSampleAt[index] = now;
      break;

    case SENSOR_DHT11:
    case SENSOR_DHT22:
      if (!gDht[index]) break;
      temp = gDht[index]->readTemperature();
      hum = gDht[index]->readHumidity();
      tempValid = !isnan(temp);
      humValid = !isnan(hum);
      gLastSensorSampleAt[index] = now;
      break;

    case SENSOR_ONOFF:
      temp = digitalRead(pin) == HIGH ? 1.0f : 0.0f;
      tempValid = true;
      hum = NAN;
      gLastSensorSampleAt[index] = now;
      break;

    case SENSOR_NTC:
      temp = convertNtc(readAnalogAverage(pin));
      tempValid = !isnan(temp);
      hum = NAN;
      gLastSensorSampleAt[index] = now;
      break;

    case SENSOR_PTC:
      temp = convertPtc(smoothPtcRaw(index, readAnalogTrimmedAverage(pin, 24)));
      tempValid = !isnan(temp);
      hum = NAN;
      gLastSensorSampleAt[index] = now;
      break;

    case SENSOR_PT100:
      temp = convertPt100(readAnalogAverage(pin));
      tempValid = !isnan(temp);
      hum = NAN;
      gLastSensorSampleAt[index] = now;
      break;

    case SENSOR_INTERNAL:
      temp = readInternalTemperature();
      tempValid = !isnan(temp);
      hum = NAN;
      gLastSensorSampleAt[index] = now;
      break;

    default:
      break;
  }

  if (tempValid) {
    temp += x10ToFloat(config().sensorTempCalibrationX10[index]);
  }
  if (humValid) {
    hum += x10ToFloat(config().sensorHumCalibrationX10[index]);
    if (hum < 0.0f) hum = 0.0f;
    if (hum > 100.0f) hum = 100.0f;
  }

  setSensorValues(index, temp, tempValid, hum, humValid);
}

String buildTelemetryJsonPayload() {
  StaticJsonDocument<2048> doc;
  doc["device"] = config().telemetryDeviceName[0] ? config().telemetryDeviceName : config().hostName;
  doc["location"] = config().telemetryLocation;
  doc["platform"] = appPlatformName();
  doc["uptimeSec"] = millis() / 1000UL;
  doc["ip"] = runtimeData.ipAddress;
  doc["rssi"] = runtimeData.wifiRssi;
  doc["mode"] = workModeLabel(config().workMode);
  doc["defrosting"] = runtimeData.defrosting;
  doc["highAlarm"] = runtimeData.highAlarmActive;
  doc["lowAlarm"] = runtimeData.lowAlarmActive;
  if (runtimeData.highAlarmActive || runtimeData.lowAlarmActive || runtimeData.defrosting) {
    JsonArray alarms = doc.createNestedArray("alarms");
    if (runtimeData.highAlarmActive) alarms.add("high_temp");
    if (runtimeData.lowAlarmActive) alarms.add("low_temp");
    if (runtimeData.defrosting) alarms.add("defrosting");
  }
  doc["freeHeap"] = appFreeHeap();
  doc["minHeap"] = appMinHeap();

  JsonArray temperatures = doc.createNestedArray("temperature");
  JsonArray humidity = doc.createNestedArray("humidity");
  JsonArray relays = doc.createNestedArray("relay");
  JsonArray inputs = doc.createNestedArray("input");

  for (size_t index = 0; index < kChannelCount; ++index) {
    if (runtimeData.temperatureValid[index]) temperatures.add(runtimeData.temperature[index]);
    else temperatures.add(nullptr);

    if (runtimeData.humidityValid[index]) humidity.add(runtimeData.humidity[index]);
    else humidity.add(nullptr);

    relays.add(runtimeData.relayState[index]);
    inputs.add(runtimeData.inputState[index]);
  }

  String payload;
  serializeJson(doc, payload);
  return payload;
}

String buildLegacyFormPayload() {
  String payload;
  payload.reserve(512U);
  payload += "device=" + urlEncode(config().telemetryDeviceName[0] ? String(config().telemetryDeviceName) : String(config().hostName));
  payload += "&location=" + urlEncode(String(config().telemetryLocation));
  payload += "&db=" + urlEncode(String(config().telemetryDbName));
  payload += "&setpoint=" + String(x10ToFloat(config().setpointX10), 1);
  payload += "&setpoint2=" + String(x10ToFloat(config().setpoint2X10), 1);
  payload += "&mode=" + urlEncode(String(workModeLabel(config().workMode)));
  payload += "&highAlarm=" + String(runtimeData.highAlarmActive ? 1 : 0);
  payload += "&lowAlarm=" + String(runtimeData.lowAlarmActive ? 1 : 0);
  payload += "&AL0=" + urlEncode(runtimeData.highAlarmActive ? String("high_temp") : String());
  payload += "&AL1=" + urlEncode(runtimeData.lowAlarmActive ? String("low_temp") : String());
  payload += "&AL2=" + urlEncode(runtimeData.defrosting ? String("defrosting") : String());

  for (size_t index = 0; index < kChannelCount; ++index) {
    payload += "&t" + String(index + 1U) + "=";
    if (runtimeData.temperatureValid[index]) payload += String(runtimeData.temperature[index], 1);
    payload += "&h" + String(index + 1U) + "=";
    if (runtimeData.humidityValid[index]) payload += String(runtimeData.humidity[index], 1);
    payload += "&r" + String(index + 1U) + "=" + String(runtimeData.relayState[index] ? 1 : 0);
    payload += "&i" + String(index + 1U) + "=" + String(runtimeData.inputState[index] ? 1 : 0);
  }

  return payload;
}

bool postTelemetryJson(const String& endpoint) {
  const bool secure = urlIsHttps(endpoint);
  if (secure && !config().telemetryAllowInsecureTls) {
    setRuntimeText(runtimeData.lastTelemetryStatus, sizeof(runtimeData.lastTelemetryStatus), "tls-blocked");
    setRuntimeText(runtimeData.lastTelemetryError, sizeof(runtimeData.lastTelemetryError), "strict TLS no CA");
    addLog("Telemetry blocked: no CA");
    return false;
  }

  HTTPClient http;
  const String payload = buildTelemetryJsonPayload();
  int httpCode = -1;

  if (secure) {
    gTelemetryHttpsClient.stop();
    gTelemetryHttpsClient.setInsecure();
    if (!http.begin(gTelemetryHttpsClient, endpoint)) {
      setRuntimeText(runtimeData.lastTelemetryStatus, sizeof(runtimeData.lastTelemetryStatus), "begin-failed");
      setRuntimeText(runtimeData.lastTelemetryError, sizeof(runtimeData.lastTelemetryError), "http begin failed");
      return false;
    }
  } else {
    gTelemetryHttpClient.stop();
    if (!http.begin(gTelemetryHttpClient, endpoint)) {
      setRuntimeText(runtimeData.lastTelemetryStatus, sizeof(runtimeData.lastTelemetryStatus), "begin-failed");
      setRuntimeText(runtimeData.lastTelemetryError, sizeof(runtimeData.lastTelemetryError), "http begin failed");
      return false;
    }
  }

  http.addHeader("Content-Type", "application/json");
  if (config().telemetryApiKey[0]) http.addHeader("X-API-Key", config().telemetryApiKey);
  if (config().telemetryBearer[0]) http.addHeader("Authorization", String("Bearer ") + config().telemetryBearer);
  if (config().telemetryUser[0]) http.setAuthorization(config().telemetryUser, config().telemetryPass);

  httpCode = http.POST(payload);
  runtimeData.lastTelemetryCode = httpCode > 0 ? static_cast<uint16_t>(httpCode) : 0U;
  runtimeData.lastTelemetryMillis = millis();

  if (httpCode > 0 && httpCode < 400) {
    setRuntimeText(runtimeData.lastTelemetryStatus, sizeof(runtimeData.lastTelemetryStatus), "ok");
    setRuntimeText(runtimeData.lastTelemetryError, sizeof(runtimeData.lastTelemetryError), "");
    addLog("Telemetry JSON sent: HTTP %d", httpCode);
    http.end();
    return true;
  }

  setRuntimeText(runtimeData.lastTelemetryStatus, sizeof(runtimeData.lastTelemetryStatus), "error");
  setRuntimeText(runtimeData.lastTelemetryError, sizeof(runtimeData.lastTelemetryError), http.errorToString(httpCode));
  addLog("Telemetry JSON failed: HTTP %d", httpCode);
  http.end();
  return false;
}

bool postTelemetryForm(const String& endpoint) {
  const bool secure = urlIsHttps(endpoint);
  if (secure && !config().telemetryAllowInsecureTls) {
    setRuntimeText(runtimeData.lastTelemetryStatus, sizeof(runtimeData.lastTelemetryStatus), "tls-blocked");
    setRuntimeText(runtimeData.lastTelemetryError, sizeof(runtimeData.lastTelemetryError), "strict TLS no CA");
    addLog("Telemetry blocked: no CA");
    return false;
  }

  HTTPClient http;
  const String payload = buildLegacyFormPayload();
  int httpCode = -1;

  if (secure) {
    gTelemetryHttpsClient.stop();
    gTelemetryHttpsClient.setInsecure();
    if (!http.begin(gTelemetryHttpsClient, endpoint)) {
      setRuntimeText(runtimeData.lastTelemetryStatus, sizeof(runtimeData.lastTelemetryStatus), "begin-failed");
      setRuntimeText(runtimeData.lastTelemetryError, sizeof(runtimeData.lastTelemetryError), "http begin failed");
      return false;
    }
  } else {
    gTelemetryHttpClient.stop();
    if (!http.begin(gTelemetryHttpClient, endpoint)) {
      setRuntimeText(runtimeData.lastTelemetryStatus, sizeof(runtimeData.lastTelemetryStatus), "begin-failed");
      setRuntimeText(runtimeData.lastTelemetryError, sizeof(runtimeData.lastTelemetryError), "http begin failed");
      return false;
    }
  }

  http.addHeader("Content-Type", "application/x-www-form-urlencoded");
  if (config().telemetryApiKey[0]) http.addHeader("X-API-Key", config().telemetryApiKey);
  if (config().telemetryBearer[0]) http.addHeader("Authorization", String("Bearer ") + config().telemetryBearer);
  if (config().telemetryUser[0]) http.setAuthorization(config().telemetryUser, config().telemetryPass);

  httpCode = http.POST(payload);
  runtimeData.lastTelemetryCode = httpCode > 0 ? static_cast<uint16_t>(httpCode) : 0U;
  runtimeData.lastTelemetryMillis = millis();

  if (httpCode > 0 && httpCode < 400) {
    setRuntimeText(runtimeData.lastTelemetryStatus, sizeof(runtimeData.lastTelemetryStatus), "ok");
    setRuntimeText(runtimeData.lastTelemetryError, sizeof(runtimeData.lastTelemetryError), "");
    addLog("Telemetry FORM sent: HTTP %d", httpCode);
    http.end();
    return true;
  }

  setRuntimeText(runtimeData.lastTelemetryStatus, sizeof(runtimeData.lastTelemetryStatus), "error");
  setRuntimeText(runtimeData.lastTelemetryError, sizeof(runtimeData.lastTelemetryError), http.errorToString(httpCode));
  addLog("Telemetry FORM failed: HTTP %d", httpCode);
  http.end();
  return false;
}

uint16_t modbusReadValue(uint16_t address) {
  const uint8_t scale = modbusPublishScale();

  for (size_t index = 0; index < kChannelCount; ++index) {
    if (address == config().modbusTempRegisters[index]) {
      if (!runtimeData.temperatureValid[index]) return 0;
      return static_cast<uint16_t>(lroundf(runtimeData.temperature[index] * scale));
    }
    if (address == config().modbusRelayRegisters[index]) {
      return runtimeData.relayState[index] ? 1U : 0U;
    }
  }

  for (size_t index = 0; index < kHumidityChannelCount; ++index) {
    if (address == config().modbusHumRegisters[index]) {
      if (!runtimeData.humidityValid[index]) return 0;
      return static_cast<uint16_t>(lroundf(runtimeData.humidity[index] * scale));
    }
  }

  if (address == config().modbusSetpointRegister) {
    return static_cast<uint16_t>(lroundf(x10ToFloat(config().setpointX10) * scale));
  }

  if (address == config().modbusStatusRegister) {
    uint16_t status = 0;
    if (runtimeData.wifiConnected) status |= 0x0001;
    if (runtimeData.defrosting) status |= 0x0002;
    if (runtimeData.highAlarmActive) status |= 0x0004;
    if (runtimeData.lowAlarmActive) status |= 0x0008;
    status |= static_cast<uint16_t>(config().workMode & 0x0F) << 8;
    return status;
  }

  return 0;
}

uint16_t onModbusRead(TRegister* reg, uint16_t value) {
  (void)value;
  if (!reg) return 0;
  const uint16_t result = modbusReadValue(reg->address.address);
  reg->value = result;
  return result;
}

bool applyModbusWriteAddress(uint16_t address, uint16_t value) {
  const uint8_t scale = modbusPublishScale();
  bool configChanged = false;

  if (address == config().modbusSetpointRegister) {
    mutableConfig().setpointX10 = static_cast<int16_t>(lroundf((static_cast<float>(value) * 10.0f) / scale));
    configChanged = true;
    snprintf(runtimeData.lastModbusWrite, sizeof(runtimeData.lastModbusWrite), "setpoint=%u", value);
    addLog("Modbus write setpoint -> %u", value);
  }

  for (size_t index = 0; index < kChannelCount; ++index) {
    if (address == config().modbusRelayRegisters[index]) {
      runtimeData.manualRelayState[index] = value != 0;
      snprintf(runtimeData.lastModbusWrite, sizeof(runtimeData.lastModbusWrite), "relay%u=%u", static_cast<unsigned>(index + 1U), value);
      addLog("Modbus write relay%u -> %s", static_cast<unsigned>(index + 1U), runtimeData.manualRelayState[index] ? "ON" : "OFF");
      break;
    }
  }

  if (configChanged && !saveConfigToFile()) {
    addLog("Modbus config persistence failed");
  }
  return configChanged;
}

uint16_t onModbusWrite(TRegister* reg, uint16_t value) {
  if (!reg) return value;
  applyModbusWriteAddress(reg->address.address, value);
  reg->value = value;
  return value;
}

template <typename TModbus>
void configureModbusRegisterMap(TModbus& bus) {
  for (size_t index = 0; index < kChannelCount; ++index) {
    if (config().modbusTempRegisters[index]) {
      bus.addHreg(config().modbusTempRegisters[index], 0U);
      bus.onGetHreg(config().modbusTempRegisters[index], onModbusRead);
    }

    if (config().modbusRelayRegisters[index]) {
      bus.addHreg(config().modbusRelayRegisters[index], 0U);
      bus.onGetHreg(config().modbusRelayRegisters[index], onModbusRead);
      bus.onSetHreg(config().modbusRelayRegisters[index], onModbusWrite);
    }
  }

  for (size_t index = 0; index < kHumidityChannelCount; ++index) {
    if (!config().modbusHumRegisters[index]) continue;
    bus.addHreg(config().modbusHumRegisters[index], 0U);
    bus.onGetHreg(config().modbusHumRegisters[index], onModbusRead);
  }

  if (config().modbusSetpointRegister) {
    bus.addHreg(config().modbusSetpointRegister, 0U);
    bus.onGetHreg(config().modbusSetpointRegister, onModbusRead);
    bus.onSetHreg(config().modbusSetpointRegister, onModbusWrite);
  }

  if (config().modbusStatusRegister) {
    bus.addHreg(config().modbusStatusRegister, 0U);
    bus.onGetHreg(config().modbusStatusRegister, onModbusRead);
  }
}

#if APP_HAS_MODBUS_RTU
void clearModbusBridgeState() {
  gModbusBridgeClientIp = IPAddress();
  gModbusBridgeTransactionId = 0;
  gModbusBridgeSlaveId = 0;
  gModbusBridgeFunction = 0;
}

bool beginModbusRtuSerial() {
  if (kModbusRtuFixedRxPin < 0 || kModbusRtuFixedTxPin < 0) {
    setModbusStatus("rtu pins missing");
    addLog("Modbus RTU pins missing");
    return false;
  }

  Serial2.begin(config().modbusRtuBaud, SERIAL_8N1, kModbusRtuFixedRxPin, kModbusRtuFixedTxPin);
  modbusRtu.begin(&Serial2, kModbusRtuFixedDePin);
  return true;
}

bool onModbusRtuBridgeTransaction(Modbus::ResultCode event, uint16_t transactionId, void* data) {
  (void)transactionId;
  (void)data;
  gModbusLastRtuEvent = event;
  if (event == Modbus::EX_SUCCESS || !gModbusBridgeTransactionId) return true;

  modbusIp.setTransactionId(gModbusBridgeTransactionId);
  modbusIp.errorResponce(gModbusBridgeClientIp,
                         static_cast<Modbus::FunctionCode>(gModbusBridgeFunction),
                         event == Modbus::EX_TIMEOUT ? Modbus::EX_DEVICE_FAILED_TO_RESPOND : Modbus::EX_SLAVE_FAILURE,
                         gModbusBridgeSlaveId);
  setModbusStatus(String("bridge error ") + String(static_cast<int>(event)));
  addLog("Modbus TCP->RTU bridge error: 0x%02X", static_cast<unsigned>(event));
  clearModbusBridgeState();
  return true;
}

Modbus::ResultCode onModbusRtuBridgeRaw(uint8_t* data, uint8_t len, void* custom) {
  (void)custom;
  if (!gModbusBridgeTransactionId) return Modbus::EX_SUCCESS;

  modbusIp.setTransactionId(gModbusBridgeTransactionId);
  modbusIp.rawResponce(gModbusBridgeClientIp, data, len, gModbusBridgeSlaveId);
  setModbusStatus(String("bridge ok slave ") + String(gModbusBridgeSlaveId));
  clearModbusBridgeState();
  return Modbus::EX_SUCCESS;
}

Modbus::ResultCode onModbusTcpBridgeRaw(uint8_t* data, uint8_t len, void* custom) {
  auto* frame = static_cast<Modbus::frame_arg_t*>(custom);
  if (!frame || !len) return Modbus::EX_ILLEGAL_FUNCTION;

  if (frame->unitId == config().modbusUnitId) {
    return Modbus::EX_PASSTHROUGH;
  }

  if (!frame->unitId) {
    modbusIp.setTransactionId(frame->transactionId);
    modbusIp.errorResponce(IPAddress(frame->ipaddr), static_cast<Modbus::FunctionCode>(data[0]), Modbus::EX_ILLEGAL_FUNCTION, frame->unitId);
    return Modbus::EX_ILLEGAL_FUNCTION;
  }

  if (gModbusBridgeTransactionId) {
    modbusIp.setTransactionId(frame->transactionId);
    modbusIp.errorResponce(IPAddress(frame->ipaddr), static_cast<Modbus::FunctionCode>(data[0]), Modbus::EX_SLAVE_DEVICE_BUSY, frame->unitId);
    return Modbus::EX_SLAVE_DEVICE_BUSY;
  }

  gModbusBridgeClientIp = IPAddress(frame->ipaddr);
  gModbusBridgeTransactionId = frame->transactionId;
  gModbusBridgeSlaveId = frame->unitId;
  gModbusBridgeFunction = data[0];
  setModbusStatus(String("bridge req slave ") + String(gModbusBridgeSlaveId));

  if (!modbusRtu.rawRequest(gModbusBridgeSlaveId, data, len, onModbusRtuBridgeTransaction)) {
    modbusIp.setTransactionId(gModbusBridgeTransactionId);
    modbusIp.errorResponce(gModbusBridgeClientIp,
                           static_cast<Modbus::FunctionCode>(gModbusBridgeFunction),
                           Modbus::EX_SLAVE_FAILURE,
                           gModbusBridgeSlaveId);
    setModbusStatus("bridge dispatch failed");
    clearModbusBridgeState();
    return Modbus::EX_SLAVE_FAILURE;
  }

  return Modbus::EX_SUCCESS;
}

bool onModbusMirrorTransaction(Modbus::ResultCode event, uint16_t transactionId, void* data) {
  (void)transactionId;
  (void)data;
  gModbusLastRtuEvent = event;
  return true;
}

bool readRemoteHoldingRegister(uint16_t address, uint16_t& value) {
  value = 0;
  if (!address) return true;
  if (modbusRtu.slave()) return false;

  gModbusLastRtuEvent = Modbus::EX_TIMEOUT;
  if (!modbusRtu.readHreg(config().modbusRemoteUnitId, address, &value, 1, onModbusMirrorTransaction)) {
    gModbusLastRtuEvent = Modbus::EX_GENERAL_FAILURE;
    return false;
  }

  const uint32_t timeoutMs = config().modbusTaskMs < 250U ? 500U : static_cast<uint32_t>(config().modbusTaskMs) * 2U;
  const uint32_t startedAt = millis();
  while (modbusRtu.slave() && (millis() - startedAt) < timeoutMs) {
    modbusRtu.task();
    yield();
  }

  if (modbusRtu.slave()) {
    return false;
  }

  return gModbusLastRtuEvent == Modbus::EX_SUCCESS;
}

bool writeRemoteHoldingRegister(uint16_t address, uint16_t value) {
  if (!address) return true;
  if (modbusRtu.slave()) return false;

  gModbusLastRtuEvent = Modbus::EX_TIMEOUT;
  if (!modbusRtu.writeHreg(config().modbusRemoteUnitId, address, value, onModbusMirrorTransaction)) {
    gModbusLastRtuEvent = Modbus::EX_GENERAL_FAILURE;
    return false;
  }

  const uint32_t timeoutMs = config().modbusTaskMs < 250U ? 500U : static_cast<uint32_t>(config().modbusTaskMs) * 2U;
  const uint32_t startedAt = millis();
  while (modbusRtu.slave() && (millis() - startedAt) < timeoutMs) {
    modbusRtu.task();
    yield();
  }

  if (modbusRtu.slave()) {
    return false;
  }

  return gModbusLastRtuEvent == Modbus::EX_SUCCESS;
}

void pushLocalSetpointToRemoteIfNeeded() {
  const uint16_t remoteRegister = modbusMirrorSetpointSourceRegister();
  if (!modbusMirrorModeActive() || !remoteRegister) {
    gMirrorSetpointTracked = false;
    return;
  }

  const int16_t localSetpointX10 = config().setpointX10;
  if (!gMirrorSetpointTracked) {
    gMirrorSetpointTracked = true;
    gMirrorSetpointX10 = localSetpointX10;
    return;
  }

  if (localSetpointX10 == gMirrorSetpointX10) return;

  const uint8_t scale = modbusMirrorScale();
  const uint16_t scaledValue = static_cast<uint16_t>(lroundf(x10ToFloat(localSetpointX10) * static_cast<float>(scale)));
  if (!writeRemoteHoldingRegister(remoteRegister, scaledValue)) {
    addLog("Mirror setpoint write fail reg %u code 0x%02X",
           static_cast<unsigned>(remoteRegister),
           static_cast<unsigned>(gModbusLastRtuEvent));
    return;
  }

  gMirrorSetpointX10 = localSetpointX10;
  addLog("Mirror setpoint write reg %u -> %u",
         static_cast<unsigned>(remoteRegister),
         static_cast<unsigned>(scaledValue));
}

void applyRemoteModbusMirrorValue(uint16_t address, uint16_t value) {
  const float scale = static_cast<float>(modbusMirrorScale());

  for (size_t index = 0; index < kChannelCount; ++index) {
    if (address == modbusMirrorTempSourceRegister(index)) {
      runtimeData.temperature[index] = static_cast<float>(value) / scale;
      runtimeData.temperatureValid[index] = true;
      return;
    }
    if (address == modbusMirrorRelaySourceRegister(index)) {
      runtimeData.manualRelayState[index] = value != 0;
      runtimeData.relayState[index] = value != 0;
      return;
    }
  }

  for (size_t index = 0; index < kHumidityChannelCount; ++index) {
    if (address == modbusMirrorHumSourceRegister(index)) {
      runtimeData.humidity[index] = static_cast<float>(value) / scale;
      runtimeData.humidityValid[index] = true;
      return;
    }
  }

  if (address == modbusMirrorSetpointSourceRegister()) {
    mutableConfig().setpointX10 = static_cast<int16_t>(lroundf((static_cast<float>(value) * 10.0f) / scale));
    gMirrorSetpointTracked = true;
    gMirrorSetpointX10 = mutableConfig().setpointX10;
    return;
  }

  if (address == modbusMirrorStatusSourceRegister()) {
    runtimeData.defrosting = (value & 0x0002U) != 0;
    runtimeData.highAlarmActive = (value & 0x0004U) != 0;
    runtimeData.lowAlarmActive = (value & 0x0008U) != 0;
  }
}

bool pollRemoteModbusMirror() {
  if (!modbusMirrorStatusSourceRegister()) {
    runtimeData.defrosting = false;
    runtimeData.highAlarmActive = false;
    runtimeData.lowAlarmActive = false;
  }

  const uint16_t addresses[] = {
    modbusMirrorTempSourceRegister(0),
    modbusMirrorTempSourceRegister(1),
    modbusMirrorTempSourceRegister(2),
    modbusMirrorTempSourceRegister(3),
    modbusMirrorHumSourceRegister(0),
    modbusMirrorHumSourceRegister(1),
    modbusMirrorRelaySourceRegister(0),
    modbusMirrorRelaySourceRegister(1),
    modbusMirrorRelaySourceRegister(2),
    modbusMirrorRelaySourceRegister(3),
    modbusMirrorSetpointSourceRegister(),
    modbusMirrorStatusSourceRegister(),
  };

  bool ok = true;
  uint16_t firstFailedAddress = 0;
  Modbus::ResultCode firstFailedCode = Modbus::EX_SUCCESS;
  uint8_t failedCount = 0;
  for (uint16_t address : addresses) {
    if (!address) continue;
    uint16_t value = 0;
    if (!readRemoteHoldingRegister(address, value)) {
      if (!firstFailedAddress) {
        firstFailedAddress = address;
        firstFailedCode = gModbusLastRtuEvent;
      }
      if (failedCount < 255U) failedCount++;
      ok = false;
      continue;
    }
    applyRemoteModbusMirrorValue(address, value);
  }

  if (ok) {
    setModbusStatus(String("mirror slave ") + String(config().modbusRemoteUnitId) + String(" ok"));
  } else {
    setModbusStatus(String("mirror slave ") + String(config().modbusRemoteUnitId) + String(" partial error"));
    addLog("Mirror read fails: %u (reg %u code 0x%02X)",
           static_cast<unsigned>(failedCount),
           static_cast<unsigned>(firstFailedAddress),
           static_cast<unsigned>(firstFailedCode));
  }
  return ok;
}
#endif

void setupModbusRuntime() {
  if (!gHasStoredConfig || !config().enableModbus || config().modbusMode == MODBUS_OFF) {
    gModbusServerConfigured = false;
    setModbusStatus("disabled");
    addLog("Boot step: Modbus disabled");
    return;
  }

  if (!modbusModeSupported(config().modbusMode)) {
    gModbusServerConfigured = false;
    setModbusStatus("unsupported on this platform");
    addLog("Modbus mode %s unsupported on %s", modbusModeLabel(config().modbusMode), appPlatformName());
    return;
  }

  switch (config().modbusMode) {
    case MODBUS_TCP_SERVER:
      configureModbusRegisterMap(modbusIp);
      modbusIp.server(config().modbusPort);
      setModbusStatus(String("tcp server ") + String(config().modbusPort));
      break;

#if APP_HAS_MODBUS_RTU
    case MODBUS_RTU_SERVER:
      if (!beginModbusRtuSerial()) {
        gModbusServerConfigured = false;
        return;
      }
      modbusRtu.server(config().modbusUnitId);
      configureModbusRegisterMap(modbusRtu);
      setModbusStatus(String("rtu server ") + String(config().modbusUnitId));
      break;

    case MODBUS_TCP_TO_RTU:
      if (!beginModbusRtuSerial()) {
        gModbusServerConfigured = false;
        return;
      }
      modbusRtu.master();
      clearModbusBridgeState();
      configureModbusRegisterMap(modbusIp);
      modbusIp.server(config().modbusPort);
      modbusIp.onRaw(onModbusTcpBridgeRaw);
      modbusRtu.onRaw(onModbusRtuBridgeRaw);
      setModbusStatus(String("bridge tcp ") + String(config().modbusPort));
      break;

    case MODBUS_SLAVE_TO_ME:
      if (!beginModbusRtuSerial()) {
        gModbusServerConfigured = false;
        return;
      }
      modbusRtu.master();
      setModbusStatus(String("mirror slave ") + String(config().modbusRemoteUnitId));
      break;

    case MODBUS_SLAVE_TO_ME_HYBRID_TCP:
      if (!beginModbusRtuSerial()) {
        gModbusServerConfigured = false;
        return;
      }
      modbusRtu.master();
      configureModbusRegisterMap(modbusIp);
      modbusIp.server(config().modbusPort);
      setModbusStatus(String("mirror slave ") + String(config().modbusRemoteUnitId) +
                      String(" + tcp ") + String(config().modbusPort));
      break;
#endif

    default:
      gModbusServerConfigured = false;
      setModbusStatus("disabled");
      return;
  }

  gModbusServerConfigured = true;
}

void armOperationalRuntime() {
  if (!gHasStoredConfig) return;
  configurePins();
  clearSensorObjects();
  initSensorObjects();
  controlDriver.setEdgeInterval(config().controlPeriodMs);
  modbusDriver.setEdgeInterval(config().modbusTaskMs);
  if (!gModbusServerConfigured && config().enableModbus && config().modbusMode != MODBUS_OFF) {
    setupModbusRuntime();
    addLog("Modbus armed no reboot");
  }
  gOperationalRuntimeArmed = true;
  addLog("Operational runtime armed");
}

void startConfigTask() {}
void processConfigTask() {}
void endConfigTask() {}

void startSystemTask() {
  systemDriver.data.runs = 0;
  addLog("System task started on %s", appPlatformName());
}

void processSystemTask() {
  systemDriver.data.runs++;
  const uint32_t now = millis();
  manageConnectivity(now);
  updateRuntimeNetwork(now);
  ensureOtaReady();
  maybeRestartForSchedule(now);
}

void endSystemTask() {
  if (gMdnsStarted) {
    MDNS.end();
    gMdnsStarted = false;
  }
}

void startSensorTask() {
  sensorDriver.data.runs = 0;
  if (!gHasStoredConfig) {
    addLog("Sensor task idle");
    return;
  }
  initSensorObjects();
  addLog("Sensor task started");
}

void processSensorTask() {
  sensorDriver.data.runs++;
  if (!gHasStoredConfig) return;
  const uint32_t now = millis();

  if (!modbusMirrorModeActive()) {
    for (size_t index = 0; index < kChannelCount; ++index) {
      sampleSensorChannel(index, now);
    }
    return;
  }

  for (size_t index = 0; index < kChannelCount; ++index) {
    const bool mirrorTemp = modbusMirrorTempSourceRegister(index) != 0U;
    const bool mirrorHum = index < kHumidityChannelCount && modbusMirrorHumSourceRegister(index) != 0U;
    if (mirrorTemp && mirrorHum) continue;

    const float previousTemp = runtimeData.temperature[index];
    const bool previousTempValid = runtimeData.temperatureValid[index];
    const float previousHum = runtimeData.humidity[index];
    const bool previousHumValid = runtimeData.humidityValid[index];

    sampleSensorChannel(index, now);

    if (mirrorTemp) {
      runtimeData.temperature[index] = previousTemp;
      runtimeData.temperatureValid[index] = previousTempValid;
    }
    if (mirrorHum) {
      runtimeData.humidity[index] = previousHum;
      runtimeData.humidityValid[index] = previousHumValid;
    }
  }
}

void endSensorTask() {
  clearSensorObjects();
}

void startControlTask() {
  controlDriver.data.runs = 0;
  if (!gHasStoredConfig) {
    addLog("Control task idle");
    return;
  }
  addLog("Control task started in %s mode", workModeLabel(config().workMode));
}

void processControlTask() {
  controlDriver.data.runs++;
  if (!gHasStoredConfig) return;
  const uint32_t now = millis();
  processInputDebounce(now);

  if (modbusMirrorModeActive()) {
    gHighAlarmConditionAt = 0;
    gLowAlarmConditionAt = 0;
    applyManualMode();
    return;
  }

  runtimeData.highAlarmActive = false;
  runtimeData.lowAlarmActive = false;

  switch (config().workMode) {
    case WORK_THERMOSTAT:
      applyThermostatMode(now);
      break;
    case WORK_PUSHBUTTON:
      gHighAlarmConditionAt = 0;
      gLowAlarmConditionAt = 0;
      applyPushbuttonMode();
      break;
    case WORK_MANUAL:
      gHighAlarmConditionAt = 0;
      gLowAlarmConditionAt = 0;
      applyManualMode();
      break;
    default:
      gHighAlarmConditionAt = 0;
      gLowAlarmConditionAt = 0;
      runtimeData.defrosting = false;
      setAllRelaysOff();
      break;
  }

  handleAlarmOutput(now);
}

void endControlTask() {
  setAllRelaysOff();
}

void startTelemetryTask() {
  telemetryDriver.data.runs = 0;
  updateTelemetryIntervalFromConfig();
  setRuntimeText(runtimeData.lastTelemetryError, sizeof(runtimeData.lastTelemetryError), "");
  if (!config().enableTelemetry || config().telemetryMode == TELEMETRY_OFF) {
    setRuntimeText(runtimeData.lastTelemetryStatus, sizeof(runtimeData.lastTelemetryStatus), "disabled");
  } else if (!telemetryConfigured()) {
    setRuntimeText(runtimeData.lastTelemetryStatus, sizeof(runtimeData.lastTelemetryStatus), "config-missing");
  } else {
    setRuntimeText(runtimeData.lastTelemetryStatus, sizeof(runtimeData.lastTelemetryStatus), "idle");
  }
  addLog("Telemetry task started");
}

void processTelemetryTask() {
  telemetryDriver.data.runs++;
  updateTelemetryIntervalFromConfig();
  if (!config().enableTelemetry || config().telemetryMode == TELEMETRY_OFF) {
    setRuntimeText(runtimeData.lastTelemetryStatus, sizeof(runtimeData.lastTelemetryStatus), "disabled");
    setRuntimeText(runtimeData.lastTelemetryError, sizeof(runtimeData.lastTelemetryError), "");
    return;
  }
  if (!telemetryConfigured()) {
    setRuntimeText(runtimeData.lastTelemetryStatus, sizeof(runtimeData.lastTelemetryStatus), "config-missing");
    setRuntimeText(runtimeData.lastTelemetryError, sizeof(runtimeData.lastTelemetryError), "telemetry endpoint missing");
    return;
  }
  if (!runtimeData.wifiConnected) {
    setRuntimeText(runtimeData.lastTelemetryStatus, sizeof(runtimeData.lastTelemetryStatus), "waiting-wifi");
    return;
  }

  switch (config().telemetryMode) {
    case TELEMETRY_JSON:
      postTelemetryJson(String(config().telemetryEndpoint));
      break;
    case TELEMETRY_LEGACY_FORM:
      postTelemetryForm(String(config().telemetryEndpoint));
      break;
    default:
      setRuntimeText(runtimeData.lastTelemetryStatus, sizeof(runtimeData.lastTelemetryStatus), "disabled");
      break;
  }
  updateTelemetryIntervalFromConfig();
}

void endTelemetryTask() {}

void startCloudTask() {
  cloudDriver.data.runs = 0;
  runtimeData.cloudBusy = false;
  runtimeData.cloudWorkerStackHighWater = 0;
  copyText(runtimeData.lastCloudError, String());
  updateCloudIntervalFromConfig();
  if (!config().enableCloudIot) {
    copyText(runtimeData.lastCloudStatus, String("disabled"));
  } else if (!cloudConfigured()) {
    copyText(runtimeData.lastCloudStatus, String("config-missing"));
  } else {
    copyText(runtimeData.lastCloudStatus, String("idle"));
  }
#if defined(ARDUINO_ARCH_ESP32)
  ensureCloudWorkerStarted();
#endif
  addLog("Cloud IoT task started");
}

void processCloudTask() {
  cloudDriver.data.runs++;
  updateCloudIntervalFromConfig();
  if (!config().enableCloudIot) {
    runtimeData.cloudBusy = false;
    copyText(runtimeData.lastCloudStatus, String("disabled"));
    copyText(runtimeData.lastCloudError, String());
    return;
  }
  if (!cloudConfigured()) {
    runtimeData.cloudBusy = false;
    copyText(runtimeData.lastCloudStatus, String("config-missing"));
    copyText(runtimeData.lastCloudError, String("cloud provisioning incomplete"));
    return;
  }
  if (!runtimeData.wifiConnected) {
    runtimeData.cloudBusy = false;
    copyText(runtimeData.lastCloudStatus, String("waiting-wifi"));
    return;
  }
#if defined(ARDUINO_ARCH_ESP32)
  ensureCloudWorkerStarted();
  if (!gCloudWorkerHandle) return;
  if (runtimeData.cloudBusy) return;

  runtimeData.cloudBusy = true;
  copyText(runtimeData.lastCloudStatus, String("dispatch"));
  xTaskNotifyGive(gCloudWorkerHandle);
#else
  processIotCloud();
#endif
  updateCloudIntervalFromConfig();
}

void endCloudTask() {
  runtimeData.cloudBusy = false;
}

void startModbusTask() {
  modbusDriver.data.runs = 0;
  if (!config().enableModbus || config().modbusMode == MODBUS_OFF) setModbusStatus("disabled");
  addLog("Modbus task started in %s mode", modbusModeLabel(config().modbusMode));
}

void processModbusTask() {
  modbusDriver.data.runs++;
  if (!config().enableModbus || config().modbusMode == MODBUS_OFF) return;
  if (!modbusModeSupported(config().modbusMode)) return;
  if (!gModbusServerConfigured) return;

  const uint8_t mode = config().modbusMode;
  if (mode != MODBUS_SLAVE_TO_ME_HYBRID_TCP && modbusModeUsesTcp(mode) && !runtimeData.wifiConnected) {
    setModbusStatus(String(modbusModeLabel(config().modbusMode)) + String(" waiting wifi"));
    return;
  }

  switch (mode) {
#if APP_HAS_MODBUS_RTU
    case MODBUS_RTU_SERVER:
      modbusRtu.task();
      break;

    case MODBUS_TCP_TO_RTU:
      modbusIp.task();
      modbusRtu.task();
      break;

    case MODBUS_SLAVE_TO_ME:
      pushLocalSetpointToRemoteIfNeeded();
      pollRemoteModbusMirror();
      modbusRtu.task();
      break;

    case MODBUS_SLAVE_TO_ME_HYBRID_TCP:
      modbusIp.task();
      pushLocalSetpointToRemoteIfNeeded();
      pollRemoteModbusMirror();
      modbusRtu.task();
      break;
#endif

    case MODBUS_TCP_SERVER:
      modbusIp.task();
      break;

    default:
      break;
  }
}

void endModbusTask() {
  setModbusStatus("stopped");
}

}  // namespace

AppConfigData& mutableConfig() {
  return configDriver.data;
}

const AppConfigData& config() {
  return configDriver.data;
}

bool hasStoredConfig() {
  return gHasStoredConfig;
}
void addLog(const char* format, ...) {
  char buffer[LogBuffer::kLineSize];
  va_list args;
  va_start(args, format);
  vsnprintf(buffer, sizeof(buffer), format, args);
  va_end(args);
  logInternal(buffer);
}

bool saveConfigToFile() {
  sanitizeConfig(configDriver.data);
  if (saveConfigDocument(configDriver.data)) {
    gHasStoredConfig = true;
    addLog("Config saved to %s", kConfigFile);
    return true;
  }
  addLog("Config save failed: %s", kConfigFile);
  return false;
}

void scheduleRestart(const char* reason, uint32_t delayMs) {
  runtimeData.pendingRestartAtMillis = millis() + delayMs;
  setRuntimeText(runtimeData.lastRestartReason, sizeof(runtimeData.lastRestartReason), String(reason ? reason : "restart"));
  addLog("Restart scheduled: %s", runtimeData.lastRestartReason);
}

void factoryResetAndRestart() {
  if (!appBeginFilesystem()) {
    addLog("Factory reset: FS unavailable");
    return;
  }
  if (APP_FILESYSTEM.exists(kConfigFile) && !APP_FILESYSTEM.remove(kConfigFile)) {
    addLog("Factory reset: remove %s fail", kConfigFile);
    return;
  }
  stopProvisioningAccessPoint();
  resetConfigToDefaults(configDriver.data);
  applyCommissioningSafeDefaults(configDriver.data);
  sanitizeConfig(configDriver.data);
  gHasStoredConfig = false;
  gOperationalRuntimeArmed = false;
  gModbusServerConfigured = false;
  addLog("Factory reset prepared, stored config erased");
  scheduleRestart("factory reset", 1000U);
}

bool ensureAdminAuthenticated() {
  if (!gHasStoredConfig) return true;
  if (server.authenticate(config().adminUser, config().adminPass)) return true;
  server.requestAuthentication();
  return false;
}

String buildStateJson() {
  StaticJsonDocument<3328> doc;
  doc["platform"] = appPlatformName();
  doc["mode"] = workModeLabel(config().workMode);
  doc["uptimeSec"] = millis() / 1000UL;
  doc["wifiConnected"] = runtimeData.wifiConnected;
  doc["wifiHasCredentials"] = runtimeData.wifiHasCredentials;
  doc["apModeActive"] = runtimeData.apModeActive;
  doc["otaActive"] = runtimeData.otaActive;
  doc["ipAddress"] = runtimeData.ipAddress;
  doc["wifiRssi"] = runtimeData.wifiRssi;
  doc["connectedSsid"] = runtimeData.connectedSsid;
  doc["apSsid"] = runtimeData.apSsid;
  doc["freeHeap"] = appFreeHeap();
  doc["minHeap"] = appMinHeap();
  doc["loopCounter"] = runtimeData.loopCounter;
  doc["lastLoopUs"] = runtimeData.lastLoopDurationUs;
  doc["maxLoopUs"] = runtimeData.maxLoopDurationUs;
  doc["defrosting"] = runtimeData.defrosting;
  doc["highAlarmActive"] = runtimeData.highAlarmActive;
  doc["lowAlarmActive"] = runtimeData.lowAlarmActive;
  doc["lastTelemetryCode"] = runtimeData.lastTelemetryCode;
  doc["lastTelemetryStatus"] = telemetryStatusLabel();
  doc["lastTelemetryError"] = runtimeData.lastTelemetryError;
  doc["telemetryMode"] = config().telemetryMode;
  doc["lastCloudCode"] = runtimeData.lastCloudCode;
  doc["lastCloudStatus"] = cloudStatusLabel();
  doc["lastCloudError"] = runtimeData.lastCloudError;
  doc["cloudBusy"] = runtimeData.cloudBusy;
  doc["cloudWorkerStackHighWater"] = runtimeData.cloudWorkerStackHighWater;
  doc["enableCloudIot"] = config().enableCloudIot;
  doc["iotBootstrapDone"] = config().iotBootstrapDone;
  doc["iotPollSeconds"] = config().iotPollSeconds;
  doc["iotLastDesiredVersion"] = config().iotLastDesiredVersion;
  doc["lastRestartReason"] = runtimeData.lastRestartReason;
  doc["lastModbusWrite"] = runtimeData.lastModbusWrite;
  doc["modbusProfile"] = modbusModeLabel(config().modbusMode);
  doc["modbusStatus"] = runtimeData.lastModbusStatus;
  doc["setpoint"] = x10ToFloat(config().setpointX10);
  doc["setpoint2"] = x10ToFloat(config().setpoint2X10);

  JsonArray temperatures = doc.createNestedArray("temperature");
  JsonArray humidity = doc.createNestedArray("humidity");
  JsonArray tempValid = doc.createNestedArray("temperatureValid");
  JsonArray humValid = doc.createNestedArray("humidityValid");
  JsonArray inputs = doc.createNestedArray("inputState");
  JsonArray relays = doc.createNestedArray("relayState");
  JsonArray manualRelays = doc.createNestedArray("manualRelayState");

  for (size_t index = 0; index < kChannelCount; ++index) {
    if (runtimeData.temperatureValid[index]) temperatures.add(runtimeData.temperature[index]);
    else temperatures.add(nullptr);

    if (runtimeData.humidityValid[index]) humidity.add(runtimeData.humidity[index]);
    else humidity.add(nullptr);

    tempValid.add(runtimeData.temperatureValid[index]);
    humValid.add(runtimeData.humidityValid[index]);
    inputs.add(runtimeData.inputState[index]);
    relays.add(runtimeData.relayState[index]);
    manualRelays.add(runtimeData.manualRelayState[index]);
  }

  String out;
  serializeJson(doc, out);
  return out;
}

String buildConfigJson() {
  DynamicJsonDocument doc(kConfigJsonCapacity);
  serializeConfig(doc.to<JsonObject>(), config());
  String out;
  serializeJson(doc, out);
  return out;
}

String buildLogsText() {
  return gLogBuffer.toText();
}

bool updateConfigFromJson(const String& body, String& errorMessage) {
  DynamicJsonDocument doc(kConfigJsonCapacity);
  const DeserializationError error = deserializeJson(doc, body);
  if (error) {
    errorMessage = error.c_str();
    return false;
  }
  const AppConfigData previousConfig = config();
  const bool hadStoredConfig = gHasStoredConfig;
  const String previousOrg = String(previousConfig.iotOrganizationId);
  const String previousAssetId = String(previousConfig.iotAssetId);
  const String previousDeviceKey = String(previousConfig.iotDeviceKey);
  const String previousBootstrapToken = String(previousConfig.iotBootstrapToken);
  const String previousBootstrapUrl = String(previousConfig.iotBootstrapUrl);
  AppConfigData nextConfig = previousConfig;
  deserializeConfig(doc.as<JsonObjectConst>(), nextConfig);
  sanitizeConfig(nextConfig);
  const bool cloudIdentityChanged = previousOrg != String(nextConfig.iotOrganizationId) ||
                                    previousAssetId != String(nextConfig.iotAssetId) ||
                                    previousDeviceKey != String(nextConfig.iotDeviceKey) ||
                                    previousBootstrapUrl != String(nextConfig.iotBootstrapUrl);
  const bool bootstrapTokenChanged = String(nextConfig.iotBootstrapToken).length() &&
                                     previousBootstrapToken != String(nextConfig.iotBootstrapToken);
  if (cloudIdentityChanged || bootstrapTokenChanged) {
    nextConfig.iotDeviceSecret[0] = '\0';
    nextConfig.iotSyncUrl[0] = '\0';
    nextConfig.iotBootstrapDone = false;
    nextConfig.iotLastDesiredVersion = -1;
  }

  if (!nextConfig.wifiUseDhcp) {
    String wifiError;
    if (!validateStaticWifiConfig(nextConfig, wifiError)) {
      errorMessage = wifiError;
      return false;
    }
  }

  const bool connectivityChanged = connectivityConfigurationChanged(previousConfig, nextConfig);
  const bool ioChanged = ioConfigurationChanged(previousConfig, nextConfig);
  const bool sensorChanged = sensorConfigurationChanged(previousConfig, nextConfig);
  const bool modbusChanged = modbusConfigurationChanged(previousConfig, nextConfig);
  const bool controlIntervalChanged = previousConfig.controlPeriodMs != nextConfig.controlPeriodMs;
  const bool telemetryIntervalChanged = previousConfig.telemetryPeriodSec != nextConfig.telemetryPeriodSec ||
                                        previousConfig.telemetryMode != nextConfig.telemetryMode ||
                                        previousConfig.enableTelemetry != nextConfig.enableTelemetry;
  const bool cloudIntervalChanged = previousConfig.iotPollSeconds != nextConfig.iotPollSeconds ||
                                    previousConfig.enableCloudIot != nextConfig.enableCloudIot;

  configDriver.data = nextConfig;
  if (!saveConfigToFile()) {
    errorMessage = "unable to persist configuration";
    return false;
  }

  if (!hadStoredConfig || ioChanged || sensorChanged) {
    armOperationalRuntime();
  }
  if (controlIntervalChanged) {
    controlDriver.setEdgeInterval(config().controlPeriodMs);
    addLog("Control task interval updated: %u ms", config().controlPeriodMs);
  }
  if (modbusChanged) {
    modbusDriver.setEdgeInterval(config().modbusTaskMs);
    if (!gModbusServerConfigured && config().enableModbus && config().modbusMode != MODBUS_OFF) {
      setupModbusRuntime();
      addLog("Modbus armed after cfg update");
    } else if (gModbusServerConfigured) {
      addLog("Modbus cfg changed; restart queued");
      scheduleRestart("modbus cfg", 1200U);
    }
  }
  if (telemetryIntervalChanged) {
    updateTelemetryIntervalFromConfig();
  }
  if (cloudIntervalChanged) {
    updateCloudIntervalFromConfig();
  }
  if (connectivityChanged) {
    requestConnectivityReload();
    addLog("Cfg updated, connectivity reload");
  } else {
    addLog("Cfg updated, no auto reboot");
  }
  return true;
}

bool handleControlJson(const String& body, String& errorMessage) {
  DynamicJsonDocument doc(1024);
  const DeserializationError error = deserializeJson(doc, body);
  if (error) {
    errorMessage = error.c_str();
    return false;
  }

  bool configChanged = false;
  JsonObjectConst root = doc.as<JsonObjectConst>();

  if (root.containsKey("workMode")) {
    mutableConfig().workMode = root["workMode"].as<uint8_t>();
    configChanged = true;
  }
  if (root.containsKey("setpoint")) {
    mutableConfig().setpointX10 = floatToX10(root["setpoint"].as<float>());
    configChanged = true;
  }
  if (root.containsKey("setpoint2")) {
    mutableConfig().setpoint2X10 = floatToX10(root["setpoint2"].as<float>());
    configChanged = true;
  }

  JsonArrayConst manualRelays = root["manualRelays"].as<JsonArrayConst>();
  if (!manualRelays.isNull()) {
    for (size_t index = 0; index < kChannelCount && index < manualRelays.size(); ++index) {
      runtimeData.manualRelayState[index] = manualRelays[index].as<bool>();
    }
  }

  for (size_t index = 0; index < kChannelCount; ++index) {
    const String key = String("relay") + String(index + 1U);
    if (root.containsKey(key)) {
      runtimeData.manualRelayState[index] = root[key].as<bool>();
    }
  }

  sanitizeConfig(configDriver.data);
  if (configChanged && !saveConfigToFile()) {
    errorMessage = "unable to persist control change";
    return false;
  }
  return true;
}

void initializeApplication() {
  memset(&runtimeData, 0, sizeof(runtimeData));
  gLogBuffer.begin();
  runtimeData.bootMillis = millis();
  runtimeData.lastWifiOkMillis = runtimeData.bootMillis;
  runtimeData.lastDefrostCycleMillis = runtimeData.bootMillis;
  setRuntimeText(runtimeData.lastTelemetryStatus, sizeof(runtimeData.lastTelemetryStatus), "booting");
  setRuntimeText(runtimeData.lastTelemetryError, sizeof(runtimeData.lastTelemetryError), "");
  setRuntimeText(runtimeData.lastRestartReason, sizeof(runtimeData.lastRestartReason), appResetReasonText());
  setRuntimeText(runtimeData.lastModbusWrite, sizeof(runtimeData.lastModbusWrite), "");
  setModbusStatus("booting");
  addLog("Reset reason: %s", runtimeData.lastRestartReason);
  addLog("Boot heap snapshot: free=%lu min=%lu", static_cast<unsigned long>(appFreeHeap()), static_cast<unsigned long>(appMinHeap()));

  resetConfigToDefaults(configDriver.data);
  gHasStoredConfig = loadConfigDocument(configDriver.data);
  if (!gHasStoredConfig) {
    applyCommissioningSafeDefaults(configDriver.data);
  }
  sanitizeConfig(configDriver.data);
  addLog("Boot step: config %s", gHasStoredConfig ? "loaded" : "defaults-safe");

  addLog("Boot step: routes");
  registerWebRoutes();

  addLog("Boot step: connectivity");
  requestConnectivityReload();
  manageConnectivity(millis());

  addLog("Boot step: http begin");
  ensureServerStarted();

  addLog("Boot step: pin init");
  configurePins();
  gOperationalRuntimeArmed = gHasStoredConfig;
  addLog("Boot step: modbus init");
  setupModbusRuntime();

  addLog("Boot step: edge attach");
  Edge.attach(configDriver);
  Edge.attach(systemDriver, kSystemDriverMs);
  Edge.attach(sensorDriver, kSensorDriverMs);
  Edge.attach(controlDriver, config().controlPeriodMs);
  Edge.attach(telemetryDriver, currentTelemetryIntervalMs());
  Edge.attach(cloudDriver, currentCloudIntervalMs());
  Edge.attach(modbusDriver, config().modbusTaskMs);

  addLog("LH Industrial V5 initialized");
  addLog("Provisioning URI: /setup");
  addLog("AP password: %s", config().apPassword[0] ? config().apPassword : "12345678");
  addLog("Auth user: %s", config().adminUser);
}

void processApplication() {
  if (gDnsStarted) gDnsServer.processNextRequest();
  if (gServerStarted) server.handleClient();
  if (gOtaStarted) ArduinoOTA.handle();
  Edge.process();
  appUpdateMdns();
  runtimeData.loopCounter++;
  yield();
}

void recordLoopDuration(uint32_t loopDurationUs) {
  runtimeData.lastLoopDurationUs = loopDurationUs;
  if (loopDurationUs > runtimeData.maxLoopDurationUs) {
    runtimeData.maxLoopDurationUs = loopDurationUs;
  }
}

}  // namespace industrial_v2
















