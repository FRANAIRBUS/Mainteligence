#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <math.h>

namespace industrial_v2 {

static constexpr uint16_t kConfigSchemaVersion = 11;
static constexpr size_t kChannelCount = 4;
static constexpr size_t kHumidityChannelCount = 2;

enum WorkMode : uint8_t {
  WORK_DISABLED = 0,
  WORK_THERMOSTAT = 1,
  WORK_PUSHBUTTON = 2,
  WORK_MANUAL = 3,
  WORK_CUSTOM = 4,
};

enum SensorType : uint8_t {
  SENSOR_NONE = 0,
  SENSOR_DS18B20 = 1,
  SENSOR_DHT11 = 2,
  SENSOR_DHT22 = 3,
  SENSOR_ONOFF = 4,
  SENSOR_NTC = 5,
  SENSOR_PTC = 6,
  SENSOR_PT100 = 7,
  SENSOR_INTERNAL = 8,
};

enum ModbusMode : uint8_t {
  MODBUS_OFF = 0,
  MODBUS_RTU_SERVER = 1,
  MODBUS_TCP_SERVER = 2,
  MODBUS_TCP_TO_RTU = 3,
  MODBUS_SLAVE_TO_ME = 4,
  MODBUS_SLAVE_TO_ME_HYBRID_TCP = 5,
};

enum ModbusWordOrder32 : uint8_t {
  MODBUS_WORD_ORDER_HIGH_LOW = 0,
  MODBUS_WORD_ORDER_LOW_HIGH = 1,
};

enum Relay2Mode : uint8_t {
  RELAY2_DISABLED = 0,
  RELAY2_ALWAYS_ON = 1,
  RELAY2_FOLLOW_RELAY1 = 2,
  RELAY2_FOLLOW_SETPOINT2 = 3,
};

enum Relay3Mode : uint8_t {
  RELAY3_DISABLED = 0,
  RELAY3_DEFROST = 1,
  RELAY3_ALARM = 2,
};

struct AppConfigData {
  uint16_t schemaVersion;
  char hostName[32];
  char adminUser[16];
  char adminPass[24];
  char wifiSsid[40];
  char wifiPass[64];
  char apPassword[24];
  char otaPassword[24];
  bool wifiUseDhcp;
  char wifiStaticIp[16];
  char wifiSubnetMask[16];
  char wifiGateway[16];
  char wifiDns1[16];
  char wifiDns2[16];
  uint16_t wifiConnectTimeoutSec;
  bool keepApEnabled;
  bool enableMdns;
  bool enableOta;
  bool enableCloudIot;
  bool enableModbus;
  bool resetIfWifiMissing;
  uint16_t scheduledRestartHours;
  uint8_t workMode;
  char customProgram[640];
  bool relayActiveHigh;
  bool inputPullup;
  uint8_t inputPins[kChannelCount];
  uint8_t relayPins[kChannelCount];
  uint8_t sensorPins[kChannelCount];
  uint16_t inputDebounceMs;
  uint8_t sensorTypes[kChannelCount];
  int16_t sensorTempCalibrationX10[kChannelCount];
  int16_t sensorHumCalibrationX10[kChannelCount];
  uint16_t sensorPeriodMs;
  uint16_t ds18b20WaitMs;
  uint8_t analogAverageSamples;
  bool coolingMode;
  int16_t setpointX10;
  int16_t setpoint2X10;
  int16_t differentialX10;
  int16_t highAlarmX10;
  int16_t lowAlarmX10;
  uint16_t tempAlarmDelayMin;
  uint16_t controlPeriodMs;
  uint16_t defrostIntervalMin;
  uint16_t defrostDurationMin;
  int16_t defrostStopX10;
  bool stopRelay1OnDefrost;
  bool stopRelay2OnDefrost;
  uint8_t relay2Mode;
  uint8_t relay3Mode;
  char iotOrganizationId[48];
  char iotAssetId[48];
  char iotDeviceKey[48];
  char iotBootstrapToken[72];
  char iotBootstrapUrl[128];
  char iotSyncUrl[128];
  char iotDeviceSecret[80];
  char iotFirmwareVersion[40];
  char iotCapabilities[128];
  int32_t iotLastDesiredVersion;
  uint16_t iotPollSeconds;
  bool iotStoreTelemetry;
  bool iotBootstrapDone;
  bool allowInsecureTls;
  uint8_t modbusMode;
  uint8_t modbusUnitId;
  uint8_t modbusRemoteUnitId;
  uint16_t modbusPort;
  uint16_t modbusTaskMs;
  uint8_t modbusScale;
  uint8_t modbusTcpScale;
  uint8_t modbusWordOrder32;
  uint32_t modbusRtuBaud;
  uint16_t modbusTempRegisters[kChannelCount];
  uint16_t modbusMirrorTempRegisters[kChannelCount];
  uint16_t modbusHumRegisters[kHumidityChannelCount];
  uint16_t modbusMirrorHumRegisters[kHumidityChannelCount];
  uint8_t modbusTempRegisterWords[kChannelCount];
  uint8_t modbusMirrorTempRegisterWords[kChannelCount];
  uint8_t modbusHumRegisterWords[kHumidityChannelCount];
  uint8_t modbusMirrorHumRegisterWords[kHumidityChannelCount];
  uint16_t modbusRelayRegisters[kChannelCount];
  uint16_t modbusMirrorRelayRegisters[kChannelCount];
  uint16_t modbusSetpointRegister;
  uint16_t modbusMirrorSetpointRegister;
  uint16_t modbusStatusRegister;
  uint16_t modbusMirrorStatusRegister;
};

struct AppRuntimeData {
  float temperature[kChannelCount];
  float humidity[kChannelCount];
  bool temperatureValid[kChannelCount];
  bool humidityValid[kChannelCount];
  bool inputState[kChannelCount];
  bool relayState[kChannelCount];
  bool manualRelayState[kChannelCount];
  bool defrosting;
  bool highAlarmActive;
  bool lowAlarmActive;
  bool wifiConnected;
  bool apModeActive;
  bool otaActive;
  bool wifiHasCredentials;
  uint32_t bootMillis;
  uint32_t lastWifiOkMillis;
  uint32_t lastDefrostStartMillis;
  uint32_t lastDefrostCycleMillis;
  uint32_t lastCloudMillis;
  uint32_t lastLoopDurationUs;
  uint32_t maxLoopDurationUs;
  uint32_t loopCounter;
  uint32_t pendingRestartAtMillis;
  int32_t wifiRssi;
  uint16_t lastCloudCode;
  uint32_t cloudWorkerStackHighWater;
  char ipAddress[20];
  char connectedSsid[40];
  char apSsid[40];
  char lastCloudStatus[24];
  char lastCloudError[96];
  char lastRestartReason[48];
  char lastModbusWrite[64];
  char lastModbusStatus[96];
  bool cloudBusy;
};

void resetConfigToDefaults(AppConfigData& config);
void sanitizeConfig(AppConfigData& config);
void serializeConfig(JsonObject json, const AppConfigData& config);
void deserializeConfig(JsonObjectConst json, AppConfigData& config);

template <size_t N>
inline void copyText(char (&dst)[N], const String& src) {
  src.substring(0, N - 1).toCharArray(dst, N);
}

template <size_t N>
inline String toString(const char (&src)[N]) {
  return String(src);
}

inline float x10ToFloat(int16_t value) {
  return static_cast<float>(value) / 10.0f;
}

inline int16_t floatToX10(float value) {
  return static_cast<int16_t>(roundf(value * 10.0f));
}

}  // namespace industrial_v2
