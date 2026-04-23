#include "AppConfig.h"
#include "BoardCompat.h"

#include <stdio.h>
#include <string.h>

namespace industrial_v2 {

namespace {

template <typename T>
T clampValue(T value, T minimumValue, T maximumValue) {
  if (value < minimumValue) return minimumValue;
  if (value > maximumValue) return maximumValue;
  return value;
}

void setDefaultText(char* dst, size_t length, const char* value) {
  if (!value || !length) return;
  strlcpy(dst, value, length);
}

String defaultHostNameFromMac() {
  uint8_t mac[6] = {0, 0, 0, 0, 0, 0};
  WiFi.macAddress(mac);

  char suffix[5];
  snprintf(suffix, sizeof(suffix), "%02X%02X", mac[4], mac[5]);

  char hostName[16];
  snprintf(hostName, sizeof(hostName), "LH-%s", suffix);
  return String(hostName);
}

void migrateLegacyIotUrl(char* dst, size_t length, const char* legacyHost, const char* modernUrl) {
  if (!dst || !length || !legacyHost || !modernUrl) return;
  String current = String(dst);
  current.trim();
  if (!current.length()) return;

  String normalized = current;
  normalized.toLowerCase();

  String host = String(legacyHost);
  host.toLowerCase();
  const String legacyHttps = String("https://") + host;
  const String legacyHttp = String("http://") + host;

  if (normalized == host || normalized == legacyHttps || normalized == legacyHttp ||
      normalized == legacyHttps + "/" || normalized == legacyHttp + "/") {
    setDefaultText(dst, length, modernUrl);
  }
}

void normalizeIotUrl(char* dst, size_t length, const char* fallbackUrl) {
  if (!dst || !length || !fallbackUrl) return;
  String current = String(dst);
  current.trim();
  if (!current.length()) {
    setDefaultText(dst, length, fallbackUrl);
    return;
  }

  if (current.startsWith("http://") || current.startsWith("https://")) {
    setDefaultText(dst, length, current.c_str());
    return;
  }

  const String withScheme = String("https://") + current;
  setDefaultText(dst, length, withScheme.c_str());
}

uint8_t clampRegisterWordCount(uint8_t words) {
  return clampValue<uint8_t>(words ? words : 1U, 1U, 2U);
}

void parseRegisterEntry(const JsonVariantConst& value,
                        uint16_t& address,
                        uint8_t& words,
                        bool* explicitWords = nullptr) {
  if (explicitWords) *explicitWords = false;
  if (value.isNull()) return;

  if (value.is<const char*>()) {
    String text = value.as<String>();
    text.trim();
    if (!text.length()) return;

    int commaIndex = text.indexOf(',');
    String addressText = commaIndex >= 0 ? text.substring(0, commaIndex) : text;
    addressText.trim();
    if (!addressText.length()) return;

    long parsedAddress = addressText.toInt();
    if (parsedAddress < 0) parsedAddress = 0;
    if (parsedAddress > 65535L) parsedAddress = 65535L;
    address = static_cast<uint16_t>(parsedAddress);
    words = 1U;

    if (commaIndex >= 0) {
      String wordsText = text.substring(commaIndex + 1);
      wordsText.trim();
      if (wordsText.length()) {
        long parsedWords = wordsText.toInt();
        if (parsedWords < 1L) parsedWords = 1L;
        if (parsedWords > 255L) parsedWords = 255L;
        words = clampRegisterWordCount(static_cast<uint8_t>(parsedWords));
        if (explicitWords) *explicitWords = true;
      }
    }
    return;
  }

  address = value.as<uint16_t>();
  words = 1U;
}

}  // namespace

void resetConfigToDefaults(AppConfigData& config) {
  memset(&config, 0, sizeof(config));
  config.schemaVersion = kConfigSchemaVersion;

  const String defaultHost = defaultHostNameFromMac();
  setDefaultText(config.hostName, sizeof(config.hostName), defaultHost.c_str());
  setDefaultText(config.adminUser, sizeof(config.adminUser), "admin");
  setDefaultText(config.adminPass, sizeof(config.adminPass), "ChangeMe123");
  setDefaultText(config.apPassword, sizeof(config.apPassword), "12345678");
  config.wifiUseDhcp = true;
  setDefaultText(config.wifiStaticIp, sizeof(config.wifiStaticIp), "192.168.20.120");
  setDefaultText(config.wifiSubnetMask, sizeof(config.wifiSubnetMask), "255.255.255.0");
  setDefaultText(config.wifiGateway, sizeof(config.wifiGateway), "192.168.20.1");
  setDefaultText(config.wifiDns1, sizeof(config.wifiDns1), "8.8.8.8");
  setDefaultText(config.wifiDns2, sizeof(config.wifiDns2), "8.8.4.4");
  config.wifiConnectTimeoutSec = 65;
  config.keepApEnabled = false;

  config.enableMdns = true;
  config.enableOta = true;
  config.enableCloudIot = false;
  config.enableModbus = false;
  config.resetIfWifiMissing = true;
  config.scheduledRestartHours = 24;
  config.workMode = WORK_THERMOSTAT;
  setDefaultText(config.customProgram, sizeof(config.customProgram),
                 "# Programa custom de ejemplo\n"
                 "BLINK REL1 500 500\n"
                 "IF TEMP1 >= 72 THEN REL2 ON\n"
                 "IF TEMP1 <= 70 THEN REL2 OFF\n");

  config.relayActiveHigh = true;
#if defined(ARDUINO_ARCH_ESP8266)
  config.inputPullup = true;
  config.inputPins[0] = 5;
  config.inputPins[1] = 4;
  config.inputPins[2] = 14;
  config.inputPins[3] = 12;
  config.relayPins[0] = 16;
  config.relayPins[1] = 13;
  config.relayPins[2] = 15;
  config.relayPins[3] = 2;
  config.sensorPins[0] = 5;
  config.sensorPins[1] = 4;
  config.sensorPins[2] = 14;
  config.sensorPins[3] = 12;
#else
  config.inputPullup = false;
  config.inputPins[0] = 34;
  config.inputPins[1] = 35;
  config.inputPins[2] = 32;
  config.inputPins[3] = 33;
  config.relayPins[0] = 12;
  config.relayPins[1] = 13;
  config.relayPins[2] = 14;
  config.relayPins[3] = 27;
  config.sensorPins[0] = 25;
  config.sensorPins[1] = 26;
  config.sensorPins[2] = 4;
  config.sensorPins[3] = 5;
#endif
  config.inputDebounceMs = 60;

  config.sensorTypes[0] = SENSOR_DS18B20;
  config.sensorTypes[1] = SENSOR_DS18B20;
  config.sensorTypes[2] = SENSOR_NONE;
  config.sensorTypes[3] = SENSOR_NONE;
  for (size_t index = 0; index < kChannelCount; ++index) {
    config.sensorAnalogMinVoltageX100[index] = 0;
    config.sensorAnalogMaxVoltageX100[index] = 250;
    config.sensorAnalogMinValueX10[index] = 0;
    config.sensorAnalogMaxValueX10[index] = 100;
  }
  config.sensorPeriodMs = 2000;
  config.ds18b20WaitMs = 900;
  config.analogAverageSamples = 32;

  config.coolingMode = true;
  config.setpointX10 = 40;
  config.setpoint2X10 = 60;
  config.differentialX10 = 10;
  config.highAlarmX10 = 80;
  config.lowAlarmX10 = 10;
  config.tempAlarmDelayMin = 0;
  config.controlPeriodMs = 250;
  config.defrostIntervalMin = 360;
  config.defrostDurationMin = 20;
  config.defrostStopX10 = 80;
  config.stopRelay1OnDefrost = true;
  config.stopRelay2OnDefrost = true;
  config.relay2Mode = RELAY2_FOLLOW_RELAY1;
  config.relay3Mode = RELAY3_DEFROST;

  config.allowInsecureTls = false;
  setDefaultText(config.iotFirmwareVersion, sizeof(config.iotFirmwareVersion), "lh-t300-v6");
  setDefaultText(config.iotCapabilities, sizeof(config.iotCapabilities), "temperature,humidity,setpoint,power,mode");
  setDefaultText(config.iotBootstrapUrl, sizeof(config.iotBootstrapUrl), "https://us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceBootstrap");
  setDefaultText(config.iotSyncUrl, sizeof(config.iotSyncUrl), "https://us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceSync");
  config.iotLastDesiredVersion = -1;
  config.iotPollSeconds = 15;
  config.iotStoreTelemetry = true;
  config.iotBootstrapDone = false;

  config.modbusMode = MODBUS_OFF;
  config.modbusUnitId = 1;
  config.modbusRemoteUnitId = 240;
  config.modbusPort = 502;
  config.modbusTaskMs = 20;
  config.modbusScale = 10;
  config.modbusTcpScale = config.modbusScale;
  config.modbusWordOrder32 = MODBUS_WORD_ORDER_HIGH_LOW;
  config.modbusRtuBaud = 9600;
  config.modbusTempRegisters[0] = 100;
  config.modbusTempRegisters[1] = 101;
  config.modbusTempRegisters[2] = 102;
  config.modbusTempRegisters[3] = 103;
  config.modbusMirrorTempRegisters[0] = config.modbusTempRegisters[0];
  config.modbusMirrorTempRegisters[1] = config.modbusTempRegisters[1];
  config.modbusMirrorTempRegisters[2] = config.modbusTempRegisters[2];
  config.modbusMirrorTempRegisters[3] = config.modbusTempRegisters[3];
  config.modbusHumRegisters[0] = 110;
  config.modbusHumRegisters[1] = 111;
  config.modbusMirrorHumRegisters[0] = config.modbusHumRegisters[0];
  config.modbusMirrorHumRegisters[1] = config.modbusHumRegisters[1];
  config.modbusTempRegisterWords[0] = 1;
  config.modbusTempRegisterWords[1] = 1;
  config.modbusTempRegisterWords[2] = 1;
  config.modbusTempRegisterWords[3] = 1;
  config.modbusMirrorTempRegisterWords[0] = config.modbusTempRegisterWords[0];
  config.modbusMirrorTempRegisterWords[1] = config.modbusTempRegisterWords[1];
  config.modbusMirrorTempRegisterWords[2] = config.modbusTempRegisterWords[2];
  config.modbusMirrorTempRegisterWords[3] = config.modbusTempRegisterWords[3];
  config.modbusHumRegisterWords[0] = 1;
  config.modbusHumRegisterWords[1] = 1;
  config.modbusMirrorHumRegisterWords[0] = config.modbusHumRegisterWords[0];
  config.modbusMirrorHumRegisterWords[1] = config.modbusHumRegisterWords[1];
  config.modbusRelayRegisters[0] = 200;
  config.modbusRelayRegisters[1] = 201;
  config.modbusRelayRegisters[2] = 202;
  config.modbusRelayRegisters[3] = 203;
  config.modbusMirrorRelayRegisters[0] = config.modbusRelayRegisters[0];
  config.modbusMirrorRelayRegisters[1] = config.modbusRelayRegisters[1];
  config.modbusMirrorRelayRegisters[2] = config.modbusRelayRegisters[2];
  config.modbusMirrorRelayRegisters[3] = config.modbusRelayRegisters[3];
  config.modbusSetpointRegister = 300;
  config.modbusMirrorSetpointRegister = config.modbusSetpointRegister;
  config.modbusStatusRegister = 400;
  config.modbusMirrorStatusRegister = config.modbusStatusRegister;
}

void sanitizeConfig(AppConfigData& config) {
  config.schemaVersion = kConfigSchemaVersion;
  if (!config.hostName[0]) {
    const String defaultHost = defaultHostNameFromMac();
    setDefaultText(config.hostName, sizeof(config.hostName), defaultHost.c_str());
  }
  if (!config.adminUser[0]) setDefaultText(config.adminUser, sizeof(config.adminUser), "admin");
  if (!config.adminPass[0]) setDefaultText(config.adminPass, sizeof(config.adminPass), "ChangeMe123");
  if (!config.apPassword[0]) setDefaultText(config.apPassword, sizeof(config.apPassword), "12345678");
  if (!config.wifiStaticIp[0]) setDefaultText(config.wifiStaticIp, sizeof(config.wifiStaticIp), "192.168.20.120");
  if (!config.wifiSubnetMask[0]) setDefaultText(config.wifiSubnetMask, sizeof(config.wifiSubnetMask), "255.255.255.0");
  if (!config.wifiGateway[0]) setDefaultText(config.wifiGateway, sizeof(config.wifiGateway), "192.168.20.1");
  if (!config.wifiDns1[0]) setDefaultText(config.wifiDns1, sizeof(config.wifiDns1), "8.8.8.8");
  if (!config.wifiDns2[0]) setDefaultText(config.wifiDns2, sizeof(config.wifiDns2), "8.8.4.4");
  if (!config.iotFirmwareVersion[0]) setDefaultText(config.iotFirmwareVersion, sizeof(config.iotFirmwareVersion), "lh-t300-v6");
  if (!config.iotCapabilities[0]) setDefaultText(config.iotCapabilities, sizeof(config.iotCapabilities), "temperature,humidity,setpoint,power,mode");
  if (!config.iotBootstrapUrl[0]) setDefaultText(config.iotBootstrapUrl, sizeof(config.iotBootstrapUrl), "https://us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceBootstrap");
  if (!config.iotSyncUrl[0]) setDefaultText(config.iotSyncUrl, sizeof(config.iotSyncUrl), "https://us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceSync");
  migrateLegacyIotUrl(config.iotBootstrapUrl, sizeof(config.iotBootstrapUrl), "devicebootstrap.maintelligence.app", "https://us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceBootstrap");
  migrateLegacyIotUrl(config.iotSyncUrl, sizeof(config.iotSyncUrl), "devicesync.maintelligence.app", "https://us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceSync");
  normalizeIotUrl(config.iotBootstrapUrl, sizeof(config.iotBootstrapUrl), "https://us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceBootstrap");
  normalizeIotUrl(config.iotSyncUrl, sizeof(config.iotSyncUrl), "https://us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceSync");

  config.workMode = clampValue<uint8_t>(config.workMode, WORK_DISABLED, WORK_CUSTOM);
  config.inputDebounceMs = clampValue<uint16_t>(config.inputDebounceMs, 20, 1000);
  config.sensorPeriodMs = clampValue<uint16_t>(config.sensorPeriodMs, 2000, 10000);
  config.ds18b20WaitMs = clampValue<uint16_t>(config.ds18b20WaitMs, 200, 1500);
  config.analogAverageSamples = clampValue<uint8_t>(config.analogAverageSamples, 32, 32);
  config.controlPeriodMs = clampValue<uint16_t>(config.controlPeriodMs, 100, 5000);
  config.tempAlarmDelayMin = clampValue<uint16_t>(config.tempAlarmDelayMin, 0, 720);
  config.wifiConnectTimeoutSec = clampValue<uint16_t>(config.wifiConnectTimeoutSec ? config.wifiConnectTimeoutSec : 65, 5, 180);
  config.iotPollSeconds = clampValue<uint16_t>(config.iotPollSeconds ? config.iotPollSeconds : 15, 5, 3600);
  config.scheduledRestartHours = clampValue<uint16_t>(config.scheduledRestartHours, 1, 720);
  config.defrostIntervalMin = clampValue<uint16_t>(config.defrostIntervalMin, 0, 1440);
  config.defrostDurationMin = clampValue<uint16_t>(config.defrostDurationMin, 0, 240);
  config.modbusMode = clampValue<uint8_t>(config.modbusMode, MODBUS_OFF, MODBUS_SLAVE_TO_ME_HYBRID_TCP);
  config.modbusUnitId = clampValue<uint8_t>(config.modbusUnitId, 1, 247);
  if (config.modbusMode == MODBUS_TCP_TO_RTU) {
    config.modbusRemoteUnitId = clampValue<uint8_t>(config.modbusRemoteUnitId, 0, 247);
  } else {
    config.modbusRemoteUnitId = clampValue<uint8_t>(config.modbusRemoteUnitId ? config.modbusRemoteUnitId : 240, 1, 247);
  }
  config.modbusPort = clampValue<uint16_t>(config.modbusPort, 1, 65535);
  config.modbusTaskMs = clampValue<uint16_t>(config.modbusTaskMs, 10, 1000);
  config.modbusScale = clampValue<uint8_t>(config.modbusScale, 1, 100);
  config.modbusTcpScale = clampValue<uint8_t>(config.modbusTcpScale ? config.modbusTcpScale : config.modbusScale, 1, 100);
  config.modbusWordOrder32 = clampValue<uint8_t>(config.modbusWordOrder32, MODBUS_WORD_ORDER_HIGH_LOW, MODBUS_WORD_ORDER_LOW_HIGH);
  config.modbusRtuBaud = clampValue<uint32_t>(config.modbusRtuBaud ? config.modbusRtuBaud : 9600U, 1200U, 115200U);
  if (!config.modbusMirrorSetpointRegister) config.modbusMirrorSetpointRegister = config.modbusSetpointRegister;
  if (!config.modbusMirrorStatusRegister) config.modbusMirrorStatusRegister = config.modbusStatusRegister;
  config.relay2Mode = clampValue<uint8_t>(config.relay2Mode, RELAY2_DISABLED, RELAY2_FOLLOW_SETPOINT2);
  config.relay3Mode = clampValue<uint8_t>(config.relay3Mode, RELAY3_DISABLED, RELAY3_ALARM);
  if (strlen(config.apPassword) < 8) setDefaultText(config.apPassword, sizeof(config.apPassword), "12345678");
  if (!config.iotDeviceSecret[0]) config.iotBootstrapDone = false;
  if (config.iotLastDesiredVersion < -1) config.iotLastDesiredVersion = -1;

  for (size_t index = 0; index < kChannelCount; ++index) {
    config.sensorTypes[index] = clampValue<uint8_t>(config.sensorTypes[index], SENSOR_NONE, SENSOR_ANALOG_LINEAR);
    config.sensorAnalogMinVoltageX100[index] = clampValue<int16_t>(config.sensorAnalogMinVoltageX100[index], 0, 500);
    config.sensorAnalogMaxVoltageX100[index] = clampValue<int16_t>(config.sensorAnalogMaxVoltageX100[index], 0, 500);
    if (config.sensorAnalogMaxVoltageX100[index] <= config.sensorAnalogMinVoltageX100[index]) {
      if (config.sensorAnalogMinVoltageX100[index] >= 500) config.sensorAnalogMinVoltageX100[index] = 499;
      config.sensorAnalogMaxVoltageX100[index] = static_cast<int16_t>(config.sensorAnalogMinVoltageX100[index] + 1);
    }
    config.sensorAnalogMinValueX10[index] = clampValue<int16_t>(config.sensorAnalogMinValueX10[index], -30000, 30000);
    config.sensorAnalogMaxValueX10[index] = clampValue<int16_t>(config.sensorAnalogMaxValueX10[index], -30000, 30000);
    if (config.sensorAnalogMaxValueX10[index] == config.sensorAnalogMinValueX10[index]) {
      if (config.sensorAnalogMaxValueX10[index] >= 30000) config.sensorAnalogMinValueX10[index] = 29990;
      config.sensorAnalogMaxValueX10[index] = static_cast<int16_t>(config.sensorAnalogMinValueX10[index] + 10);
    }
    config.modbusTempRegisterWords[index] = clampRegisterWordCount(config.modbusTempRegisterWords[index]);
    config.modbusMirrorTempRegisterWords[index] = clampRegisterWordCount(config.modbusMirrorTempRegisterWords[index]);
    if (index < kHumidityChannelCount) {
      config.modbusHumRegisterWords[index] = clampRegisterWordCount(config.modbusHumRegisterWords[index]);
      config.modbusMirrorHumRegisterWords[index] = clampRegisterWordCount(config.modbusMirrorHumRegisterWords[index]);
    }
  }
}

void serializeConfig(JsonObject json, const AppConfigData& config) {
  json["schemaVersion"] = config.schemaVersion;
  json["hostName"] = config.hostName;
  json["adminUser"] = config.adminUser;
  json["adminPass"] = config.adminPass;
  json["wifiSsid"] = config.wifiSsid;
  json["wifiPass"] = config.wifiPass;
  json["apPassword"] = config.apPassword;
  json["otaPassword"] = config.otaPassword;
  json["wifiUseDhcp"] = config.wifiUseDhcp;
  json["wifiStaticIp"] = config.wifiStaticIp;
  json["wifiSubnetMask"] = config.wifiSubnetMask;
  json["wifiGateway"] = config.wifiGateway;
  json["wifiDns1"] = config.wifiDns1;
  json["wifiDns2"] = config.wifiDns2;
  json["wifiConnectTimeoutSec"] = config.wifiConnectTimeoutSec;
  json["keepApEnabled"] = config.keepApEnabled;
  json["enableMdns"] = config.enableMdns;
  json["enableOta"] = config.enableOta;
  json["enableCloudIot"] = config.enableCloudIot;
  json["enableModbus"] = config.enableModbus;
  json["resetIfWifiMissing"] = config.resetIfWifiMissing;
  json["scheduledRestartHours"] = config.scheduledRestartHours;
  json["workMode"] = config.workMode;
  json["customProgram"] = config.customProgram;
  json["relayActiveHigh"] = config.relayActiveHigh;
  json["inputPullup"] = config.inputPullup;
  json["inputDebounceMs"] = config.inputDebounceMs;
  json["sensorPeriodMs"] = config.sensorPeriodMs;
  json["ds18b20WaitMs"] = config.ds18b20WaitMs;
  json["analogAverageSamples"] = config.analogAverageSamples;
  json["coolingMode"] = config.coolingMode;
  json["setpointX10"] = config.setpointX10;
  json["setpoint2X10"] = config.setpoint2X10;
  json["differentialX10"] = config.differentialX10;
  json["highAlarmX10"] = config.highAlarmX10;
  json["lowAlarmX10"] = config.lowAlarmX10;
  json["tempAlarmDelayMin"] = config.tempAlarmDelayMin;
  json["controlPeriodMs"] = config.controlPeriodMs;
  json["defrostIntervalMin"] = config.defrostIntervalMin;
  json["defrostDurationMin"] = config.defrostDurationMin;
  json["defrostStopX10"] = config.defrostStopX10;
  json["stopRelay1OnDefrost"] = config.stopRelay1OnDefrost;
  json["stopRelay2OnDefrost"] = config.stopRelay2OnDefrost;
  json["relay2Mode"] = config.relay2Mode;
  json["relay3Mode"] = config.relay3Mode;
  json["iotOrganizationId"] = config.iotOrganizationId;
  json["iotAssetId"] = config.iotAssetId;
  json["iotDeviceKey"] = config.iotDeviceKey;
  json["iotBootstrapToken"] = config.iotBootstrapToken;
  json["iotBootstrapUrl"] = config.iotBootstrapUrl;
  json["iotSyncUrl"] = config.iotSyncUrl;
  json["iotDeviceSecret"] = config.iotDeviceSecret;
  json["iotFirmwareVersion"] = config.iotFirmwareVersion;
  json["iotCapabilities"] = config.iotCapabilities;
  json["iotLastDesiredVersion"] = config.iotLastDesiredVersion;
  json["iotPollSeconds"] = config.iotPollSeconds;
  json["iotStoreTelemetry"] = config.iotStoreTelemetry;
  json["iotBootstrapDone"] = config.iotBootstrapDone;
  json["allowInsecureTls"] = config.allowInsecureTls;
  json["modbusMode"] = config.modbusMode;
  json["modbusUnitId"] = config.modbusUnitId;
  json["modbusRemoteUnitId"] = config.modbusRemoteUnitId;
  json["modbusPort"] = config.modbusPort;
  json["modbusTaskMs"] = config.modbusTaskMs;
  json["modbusScale"] = config.modbusScale;
  json["modbusTcpScale"] = config.modbusTcpScale;
  json["modbusWordOrder32"] = config.modbusWordOrder32;
  json["modbusRtuBaud"] = config.modbusRtuBaud;
  json["modbusSetpointRegister"] = config.modbusSetpointRegister;
  json["modbusMirrorSetpointRegister"] = config.modbusMirrorSetpointRegister;
  json["modbusStatusRegister"] = config.modbusStatusRegister;
  json["modbusMirrorStatusRegister"] = config.modbusMirrorStatusRegister;

  JsonArray inputPins = json.createNestedArray("inputPins");
  JsonArray relayPins = json.createNestedArray("relayPins");
  JsonArray sensorPins = json.createNestedArray("sensorPins");
  JsonArray sensorTypes = json.createNestedArray("sensorTypes");
  JsonArray sensorTempCalibrationX10 = json.createNestedArray("sensorTempCalibrationX10");
  JsonArray sensorHumCalibrationX10 = json.createNestedArray("sensorHumCalibrationX10");
  JsonArray sensorAnalogMinVoltageX100 = json.createNestedArray("sensorAnalogMinVoltageX100");
  JsonArray sensorAnalogMaxVoltageX100 = json.createNestedArray("sensorAnalogMaxVoltageX100");
  JsonArray sensorAnalogMinValueX10 = json.createNestedArray("sensorAnalogMinValueX10");
  JsonArray sensorAnalogMaxValueX10 = json.createNestedArray("sensorAnalogMaxValueX10");
  JsonArray modbusTempRegisters = json.createNestedArray("modbusTempRegisters");
  JsonArray modbusMirrorTempRegisters = json.createNestedArray("modbusMirrorTempRegisters");
  JsonArray modbusHumRegisters = json.createNestedArray("modbusHumRegisters");
  JsonArray modbusMirrorHumRegisters = json.createNestedArray("modbusMirrorHumRegisters");
  JsonArray modbusTempRegisterWords = json.createNestedArray("modbusTempRegisterWords");
  JsonArray modbusMirrorTempRegisterWords = json.createNestedArray("modbusMirrorTempRegisterWords");
  JsonArray modbusHumRegisterWords = json.createNestedArray("modbusHumRegisterWords");
  JsonArray modbusMirrorHumRegisterWords = json.createNestedArray("modbusMirrorHumRegisterWords");
  JsonArray modbusRelayRegisters = json.createNestedArray("modbusRelayRegisters");
  JsonArray modbusMirrorRelayRegisters = json.createNestedArray("modbusMirrorRelayRegisters");

  for (size_t index = 0; index < kChannelCount; ++index) {
    inputPins.add(config.inputPins[index]);
    relayPins.add(config.relayPins[index]);
    sensorPins.add(config.sensorPins[index]);
    sensorTypes.add(config.sensorTypes[index]);
    sensorTempCalibrationX10.add(config.sensorTempCalibrationX10[index]);
    sensorHumCalibrationX10.add(config.sensorHumCalibrationX10[index]);
    sensorAnalogMinVoltageX100.add(config.sensorAnalogMinVoltageX100[index]);
    sensorAnalogMaxVoltageX100.add(config.sensorAnalogMaxVoltageX100[index]);
    sensorAnalogMinValueX10.add(config.sensorAnalogMinValueX10[index]);
    sensorAnalogMaxValueX10.add(config.sensorAnalogMaxValueX10[index]);
    modbusTempRegisters.add(config.modbusTempRegisters[index]);
    modbusMirrorTempRegisters.add(config.modbusMirrorTempRegisters[index]);
    modbusTempRegisterWords.add(config.modbusTempRegisterWords[index]);
    modbusMirrorTempRegisterWords.add(config.modbusMirrorTempRegisterWords[index]);
    modbusRelayRegisters.add(config.modbusRelayRegisters[index]);
    modbusMirrorRelayRegisters.add(config.modbusMirrorRelayRegisters[index]);
    if (index < kHumidityChannelCount) {
      modbusHumRegisters.add(config.modbusHumRegisters[index]);
      modbusMirrorHumRegisters.add(config.modbusMirrorHumRegisters[index]);
      modbusHumRegisterWords.add(config.modbusHumRegisterWords[index]);
      modbusMirrorHumRegisterWords.add(config.modbusMirrorHumRegisterWords[index]);
    }
  }
}

void deserializeConfig(JsonObjectConst json, AppConfigData& config) {
  const bool legacySlaveToMeHybridTcp = json["modbusSlaveToMeHybridTcp"] | false;
  const uint8_t legacyTelemetryMode = json["telemetryMode"] | 0U;
  config.schemaVersion = json["schemaVersion"] | config.schemaVersion;
  copyText(config.hostName, json["hostName"] | String(config.hostName));
  copyText(config.adminUser, json["adminUser"] | String(config.adminUser));
  copyText(config.adminPass, json["adminPass"] | String(config.adminPass));
  copyText(config.wifiSsid, json["wifiSsid"] | String(config.wifiSsid));
  copyText(config.wifiPass, json["wifiPass"] | String(config.wifiPass));
  copyText(config.apPassword, json["apPassword"] | String(config.apPassword));
  copyText(config.otaPassword, json["otaPassword"] | String(config.otaPassword));
  config.wifiUseDhcp = json["wifiUseDhcp"] | config.wifiUseDhcp;
  copyText(config.wifiStaticIp, json["wifiStaticIp"] | String(config.wifiStaticIp));
  copyText(config.wifiSubnetMask, json["wifiSubnetMask"] | String(config.wifiSubnetMask));
  copyText(config.wifiGateway, json["wifiGateway"] | String(config.wifiGateway));
  copyText(config.wifiDns1, json["wifiDns1"] | String(config.wifiDns1));
  copyText(config.wifiDns2, json["wifiDns2"] | String(config.wifiDns2));
  config.wifiConnectTimeoutSec = json["wifiConnectTimeoutSec"] | config.wifiConnectTimeoutSec;
  config.keepApEnabled = json["keepApEnabled"] | config.keepApEnabled;
  config.enableMdns = json["enableMdns"] | config.enableMdns;
  config.enableOta = json["enableOta"] | config.enableOta;
  config.enableCloudIot = json["enableCloudIot"] | config.enableCloudIot;
  config.enableModbus = json["enableModbus"] | config.enableModbus;
  config.resetIfWifiMissing = json["resetIfWifiMissing"] | config.resetIfWifiMissing;
  config.scheduledRestartHours = json["scheduledRestartHours"] | config.scheduledRestartHours;
  config.workMode = json["workMode"] | config.workMode;
  copyText(config.customProgram, json["customProgram"] | String(config.customProgram));
  config.relayActiveHigh = json["relayActiveHigh"] | config.relayActiveHigh;
  config.inputPullup = json["inputPullup"] | config.inputPullup;
  config.inputDebounceMs = json["inputDebounceMs"] | config.inputDebounceMs;
  config.sensorPeriodMs = json["sensorPeriodMs"] | config.sensorPeriodMs;
  config.ds18b20WaitMs = json["ds18b20WaitMs"] | config.ds18b20WaitMs;
  config.analogAverageSamples = json["analogAverageSamples"] | config.analogAverageSamples;
  config.coolingMode = json["coolingMode"] | config.coolingMode;
  config.setpointX10 = json["setpointX10"] | config.setpointX10;
  config.setpoint2X10 = json["setpoint2X10"] | config.setpoint2X10;
  config.differentialX10 = json["differentialX10"] | config.differentialX10;
  config.highAlarmX10 = json["highAlarmX10"] | config.highAlarmX10;
  config.lowAlarmX10 = json["lowAlarmX10"] | config.lowAlarmX10;
  config.tempAlarmDelayMin = json["tempAlarmDelayMin"] | config.tempAlarmDelayMin;
  config.controlPeriodMs = json["controlPeriodMs"] | config.controlPeriodMs;
  config.defrostIntervalMin = json["defrostIntervalMin"] | config.defrostIntervalMin;
  config.defrostDurationMin = json["defrostDurationMin"] | config.defrostDurationMin;
  config.defrostStopX10 = json["defrostStopX10"] | config.defrostStopX10;
  config.stopRelay1OnDefrost = json["stopRelay1OnDefrost"] | config.stopRelay1OnDefrost;
  config.stopRelay2OnDefrost = json["stopRelay2OnDefrost"] | config.stopRelay2OnDefrost;
  config.relay2Mode = json["relay2Mode"] | config.relay2Mode;
  config.relay3Mode = json["relay3Mode"] | config.relay3Mode;
  copyText(config.iotOrganizationId, json["iotOrganizationId"] | String(config.iotOrganizationId));
  copyText(config.iotAssetId, json["iotAssetId"] | String(config.iotAssetId));
  copyText(config.iotDeviceKey, json["iotDeviceKey"] | String(config.iotDeviceKey));
  copyText(config.iotBootstrapToken, json["iotBootstrapToken"] | String(config.iotBootstrapToken));
  copyText(config.iotBootstrapUrl, json["iotBootstrapUrl"] | String(config.iotBootstrapUrl));
  copyText(config.iotSyncUrl, json["iotSyncUrl"] | String(config.iotSyncUrl));
  copyText(config.iotDeviceSecret, json["iotDeviceSecret"] | String(config.iotDeviceSecret));
  copyText(config.iotFirmwareVersion, json["iotFirmwareVersion"] | String(config.iotFirmwareVersion));
  copyText(config.iotCapabilities, json["iotCapabilities"] | String(config.iotCapabilities));
  config.iotLastDesiredVersion = json["iotLastDesiredVersion"] | config.iotLastDesiredVersion;
  config.iotPollSeconds = json["iotPollSeconds"] | config.iotPollSeconds;
  config.iotStoreTelemetry = json["iotStoreTelemetry"] | config.iotStoreTelemetry;
  config.iotBootstrapDone = json["iotBootstrapDone"] | config.iotBootstrapDone;
  config.allowInsecureTls = json["allowInsecureTls"] | config.allowInsecureTls;
  if (legacyTelemetryMode == 3U) config.enableCloudIot = true;
  config.modbusMode = json["modbusMode"] | config.modbusMode;
  config.modbusUnitId = json["modbusUnitId"] | config.modbusUnitId;
  config.modbusRemoteUnitId = json["modbusRemoteUnitId"] | config.modbusRemoteUnitId;
  config.modbusPort = json["modbusPort"] | config.modbusPort;
  config.modbusTaskMs = json["modbusTaskMs"] | config.modbusTaskMs;
  config.modbusScale = json["modbusScale"] | config.modbusScale;
  config.modbusTcpScale = json["modbusTcpScale"] | config.modbusScale;
  config.modbusWordOrder32 = json["modbusWordOrder32"] | config.modbusWordOrder32;
  if (config.modbusMode == MODBUS_SLAVE_TO_ME && legacySlaveToMeHybridTcp) {
    config.modbusMode = MODBUS_SLAVE_TO_ME_HYBRID_TCP;
  }
  config.modbusRtuBaud = json["modbusRtuBaud"] | config.modbusRtuBaud;
  config.modbusSetpointRegister = json["modbusSetpointRegister"] | config.modbusSetpointRegister;
  config.modbusMirrorSetpointRegister = json["modbusMirrorSetpointRegister"] | config.modbusMirrorSetpointRegister;
  config.modbusStatusRegister = json["modbusStatusRegister"] | config.modbusStatusRegister;
  config.modbusMirrorStatusRegister = json["modbusMirrorStatusRegister"] | config.modbusMirrorStatusRegister;

  JsonArrayConst inputPins = json["inputPins"].as<JsonArrayConst>();
  JsonArrayConst relayPins = json["relayPins"].as<JsonArrayConst>();
  JsonArrayConst sensorPins = json["sensorPins"].as<JsonArrayConst>();
  JsonArrayConst sensorTypes = json["sensorTypes"].as<JsonArrayConst>();
  JsonArrayConst sensorTempCalibrationX10 = json["sensorTempCalibrationX10"].as<JsonArrayConst>();
  JsonArrayConst sensorHumCalibrationX10 = json["sensorHumCalibrationX10"].as<JsonArrayConst>();
  JsonArrayConst sensorAnalogMinVoltageX100 = json["sensorAnalogMinVoltageX100"].as<JsonArrayConst>();
  JsonArrayConst sensorAnalogMaxVoltageX100 = json["sensorAnalogMaxVoltageX100"].as<JsonArrayConst>();
  JsonArrayConst sensorAnalogMinValueX10 = json["sensorAnalogMinValueX10"].as<JsonArrayConst>();
  JsonArrayConst sensorAnalogMaxValueX10 = json["sensorAnalogMaxValueX10"].as<JsonArrayConst>();
  JsonArrayConst modbusTempRegisters = json["modbusTempRegisters"].as<JsonArrayConst>();
  JsonArrayConst modbusMirrorTempRegisters = json["modbusMirrorTempRegisters"].as<JsonArrayConst>();
  JsonArrayConst modbusHumRegisters = json["modbusHumRegisters"].as<JsonArrayConst>();
  JsonArrayConst modbusMirrorHumRegisters = json["modbusMirrorHumRegisters"].as<JsonArrayConst>();
  JsonArrayConst modbusTempRegisterWords = json["modbusTempRegisterWords"].as<JsonArrayConst>();
  JsonArrayConst modbusMirrorTempRegisterWords = json["modbusMirrorTempRegisterWords"].as<JsonArrayConst>();
  JsonArrayConst modbusHumRegisterWords = json["modbusHumRegisterWords"].as<JsonArrayConst>();
  JsonArrayConst modbusMirrorHumRegisterWords = json["modbusMirrorHumRegisterWords"].as<JsonArrayConst>();
  JsonArrayConst modbusRelayRegisters = json["modbusRelayRegisters"].as<JsonArrayConst>();
  JsonArrayConst modbusMirrorRelayRegisters = json["modbusMirrorRelayRegisters"].as<JsonArrayConst>();

  const bool hasMirrorTempRegisters = !modbusMirrorTempRegisters.isNull();
  const bool hasMirrorHumRegisters = !modbusMirrorHumRegisters.isNull();
  const bool hasMirrorTempRegisterWords = !modbusMirrorTempRegisterWords.isNull();
  const bool hasMirrorHumRegisterWords = !modbusMirrorHumRegisterWords.isNull();
  const bool hasMirrorRelayRegisters = !modbusMirrorRelayRegisters.isNull();

  for (size_t index = 0; index < kChannelCount; ++index) {
    bool tempWordsInline = false;
    bool mirrorTempWordsInline = false;
    bool humWordsInline = false;
    bool mirrorHumWordsInline = false;

    if (index < inputPins.size()) config.inputPins[index] = inputPins[index].as<uint8_t>();
    if (index < relayPins.size()) config.relayPins[index] = relayPins[index].as<uint8_t>();
    if (index < sensorPins.size()) config.sensorPins[index] = sensorPins[index].as<uint8_t>();
    if (index < sensorTypes.size()) config.sensorTypes[index] = sensorTypes[index].as<uint8_t>();
    if (index < sensorTempCalibrationX10.size()) config.sensorTempCalibrationX10[index] = sensorTempCalibrationX10[index].as<int16_t>();
    if (index < sensorHumCalibrationX10.size()) config.sensorHumCalibrationX10[index] = sensorHumCalibrationX10[index].as<int16_t>();
    if (index < sensorAnalogMinVoltageX100.size()) config.sensorAnalogMinVoltageX100[index] = sensorAnalogMinVoltageX100[index].as<int16_t>();
    if (index < sensorAnalogMaxVoltageX100.size()) config.sensorAnalogMaxVoltageX100[index] = sensorAnalogMaxVoltageX100[index].as<int16_t>();
    if (index < sensorAnalogMinValueX10.size()) config.sensorAnalogMinValueX10[index] = sensorAnalogMinValueX10[index].as<int16_t>();
    if (index < sensorAnalogMaxValueX10.size()) config.sensorAnalogMaxValueX10[index] = sensorAnalogMaxValueX10[index].as<int16_t>();
    if (index < modbusTempRegisters.size()) {
      parseRegisterEntry(modbusTempRegisters[index],
                         config.modbusTempRegisters[index],
                         config.modbusTempRegisterWords[index],
                         &tempWordsInline);
    }
    if (index < modbusMirrorTempRegisters.size()) {
      parseRegisterEntry(modbusMirrorTempRegisters[index],
                         config.modbusMirrorTempRegisters[index],
                         config.modbusMirrorTempRegisterWords[index],
                         &mirrorTempWordsInline);
    }
    if (index < modbusRelayRegisters.size()) config.modbusRelayRegisters[index] = modbusRelayRegisters[index].as<uint16_t>();
    if (index < modbusMirrorRelayRegisters.size()) config.modbusMirrorRelayRegisters[index] = modbusMirrorRelayRegisters[index].as<uint16_t>();
    if (index < modbusHumRegisters.size() && index < kHumidityChannelCount) {
      parseRegisterEntry(modbusHumRegisters[index],
                         config.modbusHumRegisters[index],
                         config.modbusHumRegisterWords[index],
                         &humWordsInline);
    }
    if (index < modbusMirrorHumRegisters.size() && index < kHumidityChannelCount) {
      parseRegisterEntry(modbusMirrorHumRegisters[index],
                         config.modbusMirrorHumRegisters[index],
                         config.modbusMirrorHumRegisterWords[index],
                         &mirrorHumWordsInline);
    }
    if (index < modbusTempRegisterWords.size() && !tempWordsInline) {
      config.modbusTempRegisterWords[index] = clampRegisterWordCount(modbusTempRegisterWords[index].as<uint8_t>());
    }
    if (index < modbusMirrorTempRegisterWords.size() && !mirrorTempWordsInline) {
      config.modbusMirrorTempRegisterWords[index] = clampRegisterWordCount(modbusMirrorTempRegisterWords[index].as<uint8_t>());
    }
    if (index < modbusHumRegisterWords.size() && index < kHumidityChannelCount && !humWordsInline) {
      config.modbusHumRegisterWords[index] = clampRegisterWordCount(modbusHumRegisterWords[index].as<uint8_t>());
    }
    if (index < modbusMirrorHumRegisterWords.size() && index < kHumidityChannelCount && !mirrorHumWordsInline) {
      config.modbusMirrorHumRegisterWords[index] = clampRegisterWordCount(modbusMirrorHumRegisterWords[index].as<uint8_t>());
    }
    if (!hasMirrorTempRegisters) config.modbusMirrorTempRegisters[index] = config.modbusTempRegisters[index];
    if (!hasMirrorTempRegisterWords) config.modbusMirrorTempRegisterWords[index] = config.modbusTempRegisterWords[index];
    if (!hasMirrorRelayRegisters) config.modbusMirrorRelayRegisters[index] = config.modbusRelayRegisters[index];
    if (index < kHumidityChannelCount && !hasMirrorHumRegisters) {
      config.modbusMirrorHumRegisters[index] = config.modbusHumRegisters[index];
    }
    if (index < kHumidityChannelCount && !hasMirrorHumRegisterWords) {
      config.modbusMirrorHumRegisterWords[index] = config.modbusHumRegisterWords[index];
    }
  }

  sanitizeConfig(config);
}

}  // namespace industrial_v2

