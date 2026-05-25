#include "IndustrialApp.h"

#include <ArduinoJson.h>
#include <DHT.h>
#include <DallasTemperature.h>
#include <OneWire.h>
#include <ArduinoOTA.h>
#include <DNSServer.h>
#if APP_HAS_MODBUS_RTU
#include <ModbusRTU.h>
#endif
#include <math.h>
#include <stdlib.h>
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
static constexpr uint32_t kBridgeMirrorPollMs = 2000U;
static constexpr uint32_t kBridgeMirrorIdleBeforePollMs = 4000U;
static constexpr uint32_t kModbusDiagReqLogMs = 1200U;
static constexpr uint32_t kModbusDiagRspLogMs = 1200U;
static constexpr uint32_t kModbusDiagReadLogMs = 1500U;
static constexpr uint32_t kModbusDiagDecodeLogMs = 800U;
static constexpr uint32_t kModbusDiagIgnoreLogMs = 5000U;
static constexpr uint8_t kFactoryResetButtonPin = 0U;
static constexpr uint32_t kFactoryResetHoldMs = 10000U;
static constexpr float kReferenceVoltage = 3.3f;
static constexpr float kReferenceResistor = 10000.0f;
static constexpr float kPtcEsp32RawGain = 1.81f;
static constexpr float kNominalResistance = 10000.0f;
static constexpr float kNominalTemperature = 25.0f;
static constexpr float kBeta = 3950.0f;
static constexpr size_t kConfigJsonCapacity = 10240U;
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
struct CloudTaskData { uint32_t runs = 0; };
struct ModbusTaskData { uint32_t runs = 0; };

static constexpr size_t kCustomMaxRules = 24U;
static constexpr uint32_t kCustomBlinkMinMs = 50U;
static constexpr uint32_t kCustomBlinkMaxMs = 3600000U;
static constexpr uint32_t kVirtualInputPulseMs = 180U;
static constexpr size_t kSequenceMaxProgramLines = 32U;
static constexpr size_t kSequenceMaxSteps = 24U;
static constexpr uint32_t kSequenceTimeMinMs = 50U;
static constexpr uint32_t kSequenceTimeMaxMs = 86400000U;
static constexpr uint8_t kSequenceMaxLoopIterations = 32U;

enum CustomRuleType : uint8_t {
  CUSTOM_RULE_SET = 0,
  CUSTOM_RULE_BLINK = 1,
  CUSTOM_RULE_IF = 2,
  CUSTOM_RULE_THERMOSTAT = 3,
  CUSTOM_RULE_TIMER = 4,
  CUSTOM_RULE_ONCHANGE_TOGGLE = 5,
  CUSTOM_RULE_PULSE = 6,
  CUSTOM_RULE_IFALL = 7,
  CUSTOM_RULE_IFANY = 8,
  CUSTOM_RULE_ONBOOT = 9,
};

enum CustomSignalType : uint8_t {
  CUSTOM_SIGNAL_TEMP = 0,
  CUSTOM_SIGNAL_HUM = 1,
  CUSTOM_SIGNAL_INPUT = 2,
};

enum CustomComparator : uint8_t {
  CUSTOM_CMP_EQ = 0,
  CUSTOM_CMP_NE = 1,
  CUSTOM_CMP_GT = 2,
  CUSTOM_CMP_GE = 3,
  CUSTOM_CMP_LT = 4,
  CUSTOM_CMP_LE = 5,
};

enum CustomThermostatMode : uint8_t {
  CUSTOM_TH_AUTO = 0,
  CUSTOM_TH_COOL = 1,
  CUSTOM_TH_HEAT = 2,
};

enum CustomProgramMode : uint8_t {
  CUSTOM_PROGRAM_RULES = 0,
  CUSTOM_PROGRAM_SEQUENCE = 1,
  CUSTOM_PROGRAM_MIXED = 2,
};

enum SequenceState : uint8_t {
  SEQ_STATE_IDLE = 0,
  SEQ_STATE_READY = 1,
  SEQ_STATE_RUNNING = 2,
  SEQ_STATE_WAITING = 3,
  SEQ_STATE_LOOPING = 4,
  SEQ_STATE_DONE = 5,
  SEQ_STATE_ERROR = 6,
  SEQ_STATE_ABORTED = 7,
  SEQ_STATE_SAFETY_STOP = 8,
  SEQ_STATE_ABORTED_AFTER_REBOOT = 9,
};

enum SequenceStepType : uint8_t {
  SEQ_STEP_SET = 0,
  SEQ_STEP_STEP = 1,
  SEQ_STEP_WAIT = 2,
  SEQ_STEP_WAITUNTIL = 3,
};

struct CustomRule {
  CustomRuleType type = CUSTOM_RULE_SET;
  uint8_t relayIndex = 0;
  uint8_t sourceIndex = 0;
  uint8_t sourceIndex2 = 0;
  CustomSignalType signal = CUSTOM_SIGNAL_TEMP;
  CustomSignalType signal2 = CUSTOM_SIGNAL_TEMP;
  CustomComparator comparator = CUSTOM_CMP_EQ;
  CustomComparator comparator2 = CUSTOM_CMP_EQ;
  bool actionState = false;
  float threshold = 0.0f;
  float threshold2 = 0.0f;
  float setpoint = 0.0f;
  float differential = 1.0f;
  CustomThermostatMode thermostatMode = CUSTOM_TH_AUTO;
  uint32_t onMs = 500U;
  uint32_t offMs = 500U;
  uint8_t pulseCount = 1U;
};

struct SequenceCondition {
  bool valid = false;
  CustomSignalType signal = CUSTOM_SIGNAL_TEMP;
  uint8_t sourceIndex = 0;
  CustomComparator comparator = CUSTOM_CMP_EQ;
  float threshold = 0.0f;
};

struct SequenceStep {
  SequenceStepType type = SEQ_STEP_SET;
  uint8_t relayIndex = 0;
  bool relayState = false;
  bool hasDuration = false;
  uint32_t durationMs = 0;
  SequenceCondition condition;
  uint32_t stableMs = 0;
  uint32_t maxMs = 0;
  size_t lineNumber = 0;
};

struct SequenceLoopRuntime {
  bool enabled = false;
  uint8_t beginStep = 0;
  uint8_t endStep = 0;
  uint8_t maxIterations = 0;
  SequenceCondition untilCondition;
  uint32_t stableMs = 0;
  size_t lineNumber = 0;
};

struct SequenceProgramRuntime {
  bool present = false;
  bool valid = false;
  bool running = false;
  char name[32] = {0};
  SequenceState state = SEQ_STATE_IDLE;
  uint8_t stepCount = 0;
  SequenceStep steps[kSequenceMaxSteps];
  bool startDefined = false;
  uint8_t startPhysicalMask = 0;
  uint8_t startVirtualMask = 0;
  bool startEdgeArmed = false;
  uint8_t startLastPhysicalMask = 0;
  uint8_t startLastVirtualMask = 0;
  bool safetyDefined = false;
  uint8_t safetyInputIndex = 0;
  bool safetyUsesVirtualInput = false;
  SequenceLoopRuntime loop;
  uint32_t stepStartedAt = 0;
  uint32_t loopStartedAt = 0;
  uint32_t stableStartedAt = 0;
  bool stableArmed = false;
  uint8_t currentStep = 0;
  uint8_t currentLoop = 0;
  uint8_t previousStepWithDuration = 0xFFU;
  bool previousStepAutoOffPending = false;
  float lastTemperature = NAN;
  uint8_t usedRelayMask = 0;
  uint8_t reservedRelayMask = 0;
  size_t sourceLineCount = 0;
  size_t errorLine = 0;
  char errorMessage[96] = {0};
};

struct CustomProgramRuntime {
  bool valid = false;
  uint8_t ruleCount = 0;
  uint8_t sequenceStepCount = 0;
  CustomProgramMode mode = CUSTOM_PROGRAM_RULES;
  char error[96] = {0};
  CustomRule rules[kCustomMaxRules];
  bool blinkState[kCustomMaxRules] = {false};
  uint32_t blinkAt[kCustomMaxRules] = {0};
  bool edgeArmed[kCustomMaxRules] = {false};
  bool edgeLastInput[kCustomMaxRules] = {false};
  bool pulseActive[kCustomMaxRules] = {false};
  bool pulseOnPhase[kCustomMaxRules] = {false};
  uint8_t pulseRemaining[kCustomMaxRules] = {0};
  bool onbootActive[kCustomMaxRules] = {false};
  bool onbootDone[kCustomMaxRules] = {false};
  SequenceProgramRuntime sequence;
};

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
void startCloudTask();
void processCloudTask();
void endCloudTask();
void startModbusTask();
void processModbusTask();
void endModbusTask();
bool cloudConfigured();
unsigned long currentCloudIntervalMs();
void updateCloudIntervalFromConfig();
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
void initializeFactoryResetButton();
void processFactoryResetButton(uint32_t now);
void processVirtualInputPulses(uint32_t now);
void startCaptiveDns(const IPAddress& apIp);
void stopCaptiveDns();
void applyCommissioningSafeDefaults(AppConfigData& appConfig);
bool connectivityConfigurationChanged(const AppConfigData& previous, const AppConfigData& next);
bool ioConfigurationChanged(const AppConfigData& previous, const AppConfigData& next);
bool sensorConfigurationChanged(const AppConfigData& previous, const AppConfigData& next);
bool modbusConfigurationChanged(const AppConfigData& previous, const AppConfigData& next);
void armOperationalRuntime();
bool thermostatDemandFromSensor(bool previousState, bool coolingMode, float temperature, float setpoint, float differential);
#if APP_HAS_MODBUS_RTU
void applyRemoteModbusMirrorValue(uint16_t address, uint32_t value, uint8_t sourceWords = 1U);
#endif
#if defined(ARDUINO_ARCH_ESP32)
void ensureCloudWorkerStarted();
void cloudWorkerTask(void* parameter);
#endif

EdgeDriver<AppConfigData> configDriver(startConfigTask, processConfigTask, endConfigTask);
EdgeDriver<SystemTaskData> systemDriver(startSystemTask, processSystemTask, endSystemTask);
EdgeDriver<SensorTaskData> sensorDriver(startSensorTask, processSensorTask, endSensorTask);
EdgeDriver<ControlTaskData> controlDriver(startControlTask, processControlTask, endControlTask);
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
uint32_t gLastWifiAttemptAt = 0;
bool gFactoryResetButtonEnabled = false;
bool gFactoryResetButtonHoldActive = false;
bool gFactoryResetButtonTriggered = false;
uint32_t gFactoryResetButtonPressedAt = 0;
bool gVirtualInputPulseActive[kChannelCount] = {false, false, false, false};
uint32_t gVirtualInputPulseStartedAt[kChannelCount] = {0, 0, 0, 0};
DNSServer gDnsServer;
CustomProgramRuntime gCustomProgram;
bool gCustomExecutionPrimed = false;
bool gCustomFailSafeApplied = false;
#if APP_HAS_MODBUS_RTU
IPAddress gModbusBridgeClientIp;
uint16_t gModbusBridgeTransactionId = 0;
uint8_t gModbusBridgeSlaveId = 0;
uint8_t gModbusBridgeFunction = 0;
bool gModbusBridgePending = false;
uint16_t gModbusBridgeReadStartAddress = 0;
uint16_t gModbusBridgeReadCount = 0;
uint32_t gLastBridgeTrafficAt = 0;
Modbus::ResultCode gModbusLastRtuEvent = Modbus::EX_SUCCESS;
bool gMirrorSetpointTracked = false;
int16_t gMirrorSetpointX10 = 0;
uint32_t gLastBridgeMirrorPollAt = 0;
uint32_t gLastBridgeReqLogAt = 0;
uint32_t gLastBridgeRspLogAt = 0;
uint32_t gLastRemoteReadDiagLogAt = 0;
uint32_t gLastMirrorDecodeLogAt = 0;
uint32_t gLastBridgeIgnoredUnitLogAt = 0;
uint16_t gLastMirrorDecodeAddress = 0;
uint32_t gLastMirrorDecodeRaw = 0;
uint8_t gLastMirrorDecodeWords = 0;
#endif
#if defined(ARDUINO_ARCH_ESP32)
static constexpr uint32_t kCloudWorkerStackSize = 8192U;
TaskHandle_t gCloudWorkerHandle = nullptr;
portMUX_TYPE gLogBufferMux = portMUX_INITIALIZER_UNLOCKED;
#endif

const char* workModeLabel(uint8_t mode) {
  switch (mode) {
    case WORK_THERMOSTAT: return "thermostat";
    case WORK_PUSHBUTTON: return "pushbutton";
    case WORK_MANUAL: return "manual";
    case WORK_CUSTOM: return "custom";
    default: return "disabled";
  }
}

const char* customProgramModeLabel(CustomProgramMode mode) {
  switch (mode) {
    case CUSTOM_PROGRAM_SEQUENCE: return "sequence";
    case CUSTOM_PROGRAM_MIXED: return "mixed";
    default: return "rules";
  }
}

const char* sequenceStateLabel(SequenceState state) {
  switch (state) {
    case SEQ_STATE_READY: return "READY";
    case SEQ_STATE_RUNNING: return "RUNNING";
    case SEQ_STATE_WAITING: return "WAITING";
    case SEQ_STATE_LOOPING: return "LOOPING";
    case SEQ_STATE_DONE: return "DONE";
    case SEQ_STATE_ERROR: return "ERROR";
    case SEQ_STATE_ABORTED: return "ABORTED";
    case SEQ_STATE_SAFETY_STOP: return "SAFETY_STOP";
    case SEQ_STATE_ABORTED_AFTER_REBOOT: return "ABORTED_AFTER_REBOOT";
    default: return "IDLE";
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

bool modbusBridgeMirrorCaptureActive() {
  if (!gHasStoredConfig || !config().enableModbus) return false;
  return config().modbusMode == MODBUS_TCP_TO_RTU && config().modbusRemoteUnitId != 0;
}

bool modbusMirrorReadbackActive() {
  return modbusMirrorModeActive() || modbusBridgeMirrorCaptureActive();
}

bool modbusMirrorHybridMapActive() {
  return gHasStoredConfig && config().enableModbus && config().modbusMode == MODBUS_SLAVE_TO_ME_HYBRID_TCP;
}

uint16_t modbusMirrorTempSourceRegister(size_t index) {
  if (index >= kChannelCount) return 0;
  return modbusMirrorHybridMapActive() ? config().modbusMirrorTempRegisters[index] : config().modbusTempRegisters[index];
}

uint8_t modbusMirrorTempSourceWordCount(size_t index) {
  if (index >= kChannelCount) return 1;
  const uint8_t words = modbusMirrorHybridMapActive() ?
                        config().modbusMirrorTempRegisterWords[index] :
                        config().modbusTempRegisterWords[index];
  return words > 1U ? 2U : 1U;
}

uint16_t modbusMirrorHumSourceRegister(size_t index) {
  if (index >= kHumidityChannelCount) return 0;
  return modbusMirrorHybridMapActive() ? config().modbusMirrorHumRegisters[index] : config().modbusHumRegisters[index];
}

uint8_t modbusMirrorHumSourceWordCount(size_t index) {
  if (index >= kHumidityChannelCount) return 1;
  const uint8_t words = modbusMirrorHybridMapActive() ?
                        config().modbusMirrorHumRegisterWords[index] :
                        config().modbusHumRegisterWords[index];
  return words > 1U ? 2U : 1U;
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
         !arrayEquals(previous.sensorHumCalibrationX10, next.sensorHumCalibrationX10) ||
         !arrayEquals(previous.sensorAnalogMinVoltageX100, next.sensorAnalogMinVoltageX100) ||
         !arrayEquals(previous.sensorAnalogMaxVoltageX100, next.sensorAnalogMaxVoltageX100) ||
         !arrayEquals(previous.sensorAnalogMinValueX10, next.sensorAnalogMinValueX10) ||
         !arrayEquals(previous.sensorAnalogMaxValueX10, next.sensorAnalogMaxValueX10);
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
         !arrayEquals(previous.modbusTempRegisterWords, next.modbusTempRegisterWords) ||
         !arrayEquals(previous.modbusMirrorTempRegisterWords, next.modbusMirrorTempRegisterWords) ||
         !arrayEquals(previous.modbusHumRegisterWords, next.modbusHumRegisterWords) ||
         !arrayEquals(previous.modbusMirrorHumRegisterWords, next.modbusMirrorHumRegisterWords) ||
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
        config().sensorTypes[index] == SENSOR_PT100 ||
        config().sensorTypes[index] == SENSOR_ANALOG_LINEAR) {
      analogSetPinAttenuation(config().sensorPins[index], ADC_11db);
    }
#endif
    gLastInputRaw[index] = readInputHardware(index);
    gLastInputChangeAt[index] = millis();
    runtimeData.inputState[index] = gLastInputRaw[index];
    runtimeData.virtualInputState[index] = false;
    gVirtualInputPulseActive[index] = false;
    gVirtualInputPulseStartedAt[index] = 0;
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

float analogVoltageFromRaw(float raw) {
  const float rawMax = static_cast<float>(appAnalogMax());
  if (rawMax <= 1.0f || isnan(raw)) return NAN;
  if (raw < 0.0f) raw = 0.0f;
  if (raw > rawMax) raw = rawMax;
  return raw * (kReferenceVoltage / rawMax);
}

float convertAnalogLinear(size_t index, float raw) {
  if (index >= kChannelCount) return NAN;

  const float voltage = analogVoltageFromRaw(raw);
  if (isnan(voltage)) return NAN;

  const float inMin = static_cast<float>(config().sensorAnalogMinVoltageX100[index]) / 100.0f;
  const float inMax = static_cast<float>(config().sensorAnalogMaxVoltageX100[index]) / 100.0f;
  const float outMin = x10ToFloat(config().sensorAnalogMinValueX10[index]);
  const float outMax = x10ToFloat(config().sensorAnalogMaxValueX10[index]);
  const float inSpan = inMax - inMin;
  if (fabsf(inSpan) < 0.0001f) return NAN;

  float ratio = (voltage - inMin) / inSpan;
  if (ratio < 0.0f) ratio = 0.0f;
  if (ratio > 1.0f) ratio = 1.0f;
  return outMin + ratio * (outMax - outMin);
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

bool shouldEmitDiagLog(uint32_t now, uint32_t& lastAt, uint32_t intervalMs) {
  if (!lastAt || static_cast<uint32_t>(now - lastAt) >= intervalMs) {
    lastAt = now;
    return true;
  }
  return false;
}

bool reachedDeadline(uint32_t now, uint32_t deadline) {
  return static_cast<int32_t>(now - deadline) >= 0;
}

bool factoryResetButtonPinConflicts() {
  for (size_t index = 0; index < kChannelCount; ++index) {
    if (config().relayPins[index] == kFactoryResetButtonPin) return true;
    if (config().inputPins[index] == kFactoryResetButtonPin) return true;
    if (config().sensorTypes[index] != SENSOR_NONE && config().sensorPins[index] == kFactoryResetButtonPin) return true;
  }
  return false;
}

void initializeFactoryResetButton() {
  gFactoryResetButtonEnabled = !factoryResetButtonPinConflicts();
  gFactoryResetButtonHoldActive = false;
  gFactoryResetButtonTriggered = false;
  gFactoryResetButtonPressedAt = 0;

  if (!gFactoryResetButtonEnabled) {
    addLog("Factory reset button disabled: GPIO%u used by config", static_cast<unsigned>(kFactoryResetButtonPin));
    return;
  }

  pinMode(kFactoryResetButtonPin, INPUT_PULLUP);
  addLog("Factory reset button armed on GPIO%u (hold %lu ms)",
         static_cast<unsigned>(kFactoryResetButtonPin),
         static_cast<unsigned long>(kFactoryResetHoldMs));
}

void processFactoryResetButton(uint32_t now) {
  if (!gFactoryResetButtonEnabled || gFactoryResetButtonTriggered) return;
  if (runtimeData.pendingRestartAtMillis) return;

  const bool pressed = digitalRead(kFactoryResetButtonPin) == LOW;
  if (!pressed) {
    gFactoryResetButtonHoldActive = false;
    gFactoryResetButtonPressedAt = 0;
    return;
  }

  if (!gFactoryResetButtonHoldActive) {
    gFactoryResetButtonHoldActive = true;
    gFactoryResetButtonPressedAt = now;
    return;
  }

  if (!elapsedSince(now, gFactoryResetButtonPressedAt, kFactoryResetHoldMs)) return;

  gFactoryResetButtonTriggered = true;
  addLog("Factory reset button hold reached %lu ms", static_cast<unsigned long>(kFactoryResetHoldMs));
  factoryResetAndRestart();
}

void setVirtualInputStateByIndex(uint8_t index, bool state) {
  if (index >= kChannelCount) return;
  runtimeData.virtualInputState[index] = state;
  if (!state) {
    gVirtualInputPulseActive[index] = false;
    gVirtualInputPulseStartedAt[index] = 0;
  }
}

void pulseVirtualInputByIndex(uint8_t index) {
  if (index >= kChannelCount) return;
  runtimeData.virtualInputState[index] = true;
  gVirtualInputPulseActive[index] = true;
  gVirtualInputPulseStartedAt[index] = millis();
}

void processVirtualInputPulses(uint32_t now) {
  for (size_t index = 0; index < kChannelCount; ++index) {
    if (!gVirtualInputPulseActive[index]) continue;
    if (!elapsedSince(now, gVirtualInputPulseStartedAt[index], kVirtualInputPulseMs)) continue;
    gVirtualInputPulseActive[index] = false;
    gVirtualInputPulseStartedAt[index] = 0;
    runtimeData.virtualInputState[index] = false;
  }
}

void resetSequenceRuntime(SequenceProgramRuntime& sequence) {
  sequence.present = false;
  sequence.valid = false;
  sequence.running = false;
  sequence.name[0] = '\0';
  sequence.state = SEQ_STATE_IDLE;
  sequence.stepCount = 0;
  sequence.startDefined = false;
  sequence.startPhysicalMask = 0;
  sequence.startVirtualMask = 0;
  sequence.startEdgeArmed = false;
  sequence.startLastPhysicalMask = 0;
  sequence.startLastVirtualMask = 0;
  sequence.safetyDefined = false;
  sequence.safetyInputIndex = 0;
  sequence.safetyUsesVirtualInput = false;
  sequence.loop = SequenceLoopRuntime();
  sequence.stepStartedAt = 0;
  sequence.loopStartedAt = 0;
  sequence.stableStartedAt = 0;
  sequence.stableArmed = false;
  sequence.currentStep = 0;
  sequence.currentLoop = 0;
  sequence.previousStepWithDuration = 0xFFU;
  sequence.previousStepAutoOffPending = false;
  sequence.lastTemperature = NAN;
  sequence.usedRelayMask = 0;
  sequence.reservedRelayMask = 0;
  sequence.sourceLineCount = 0;
  sequence.errorLine = 0;
  sequence.errorMessage[0] = '\0';
}

void resetCustomProgramRuntime() {
  gCustomProgram.valid = false;
  gCustomProgram.ruleCount = 0;
  gCustomProgram.sequenceStepCount = 0;
  gCustomProgram.mode = CUSTOM_PROGRAM_RULES;
  gCustomProgram.error[0] = '\0';
  for (size_t index = 0; index < kCustomMaxRules; ++index) {
    gCustomProgram.blinkState[index] = false;
    gCustomProgram.blinkAt[index] = 0;
    gCustomProgram.edgeArmed[index] = false;
    gCustomProgram.edgeLastInput[index] = false;
    gCustomProgram.pulseActive[index] = false;
    gCustomProgram.pulseOnPhase[index] = false;
    gCustomProgram.pulseRemaining[index] = 0;
    gCustomProgram.onbootActive[index] = false;
    gCustomProgram.onbootDone[index] = false;
  }
  resetSequenceRuntime(gCustomProgram.sequence);
  gCustomExecutionPrimed = false;
}

void setCustomProgramError(size_t lineNumber, const String& message) {
  const String text = lineNumber ? (String("L") + String(static_cast<unsigned>(lineNumber)) + ": " + message) : message;
  strlcpy(gCustomProgram.error, text.c_str(), sizeof(gCustomProgram.error));
  gCustomProgram.sequence.errorLine = lineNumber;
  strlcpy(gCustomProgram.sequence.errorMessage, text.c_str(), sizeof(gCustomProgram.sequence.errorMessage));
  gCustomProgram.sequence.state = SEQ_STATE_ERROR;
  gCustomProgram.sequence.running = false;
  gCustomProgram.sequence.valid = false;
  addLog("Custom program invalid: %s", gCustomProgram.error);
  gCustomProgram.valid = false;
  gCustomExecutionPrimed = false;
}

void setSequenceRuntimeError(size_t lineNumber, const String& message) {
  SequenceProgramRuntime& sequence = gCustomProgram.sequence;
  const String text = lineNumber ? (String("L") + String(static_cast<unsigned>(lineNumber)) + ": " + message) : message;
  sequence.errorLine = lineNumber;
  strlcpy(sequence.errorMessage, text.c_str(), sizeof(sequence.errorMessage));
  sequence.state = SEQ_STATE_ERROR;
  sequence.running = false;
  addLog("Sequence runtime error: %s", text.c_str());
}

size_t tokenizeCustomLine(const String& line, String* tokens, size_t maxTokens) {
  if (!tokens || !maxTokens) return 0;
  size_t count = 0;
  int start = -1;
  for (int index = 0; index <= line.length(); ++index) {
    const bool atEnd = index == line.length();
    const char ch = atEnd ? ' ' : line.charAt(index);
    const bool isSpace = ch == ' ' || ch == '\t';
    if (!isSpace && start < 0) {
      start = index;
      continue;
    }
    if ((isSpace || atEnd) && start >= 0) {
      if (count < maxTokens) {
        tokens[count++] = line.substring(start, index);
      }
      start = -1;
    }
  }
  return count;
}

String upperToken(const String& token) {
  String output = token;
  output.trim();
  output.toUpperCase();
  return output;
}

String stripCustomLineComments(const String& rawLine) {
  String line = rawLine;
  const int hashPos = line.indexOf('#');
  if (hashPos >= 0) line.remove(hashPos);
  const int slashPos = line.indexOf("//");
  if (slashPos >= 0) line.remove(slashPos);
  line.trim();
  return line;
}

bool isSimpleProgramName(const String& value) {
  if (!value.length()) return false;
  for (size_t index = 0; index < value.length(); ++index) {
    const char ch = value.charAt(index);
    const bool allowed = (ch >= 'A' && ch <= 'Z') ||
                         (ch >= 'a' && ch <= 'z') ||
                         (ch >= '0' && ch <= '9') ||
                         ch == '_' || ch == '-';
    if (!allowed) return false;
  }
  return true;
}

bool parseKeyValueToken(const String& token, String& keyOut, String& valueOut) {
  const int sep = token.indexOf('=');
  if (sep <= 0 || sep >= static_cast<int>(token.length() - 1)) return false;
  keyOut = upperToken(token.substring(0, sep));
  valueOut = token.substring(sep + 1);
  valueOut.trim();
  return keyOut.length() && valueOut.length();
}

bool containsForbiddenExpressionChars(const String& text) {
  for (size_t index = 0; index < text.length(); ++index) {
    const char ch = text.charAt(index);
    if (ch == '+' || ch == '*' || ch == '/' || ch == '(' || ch == ')') return true;
  }
  return false;
}

bool parseUnsignedLong(const String& token, uint32_t& value) {
  char* end = nullptr;
  const unsigned long parsed = strtoul(token.c_str(), &end, 10);
  if (end == token.c_str() || (end && *end != '\0')) return false;
  value = static_cast<uint32_t>(parsed);
  return true;
}

bool parseFloatValue(const String& token, float& value) {
  char* end = nullptr;
  const float parsed = strtof(token.c_str(), &end);
  if (end == token.c_str() || (end && *end != '\0')) return false;
  value = parsed;
  return true;
}

bool parseIndexedToken(const String& token, const char* prefix, size_t maxCount, uint8_t& indexOut) {
  if (!prefix) return false;
  String normalized = upperToken(token);
  const String prefixText = String(prefix);
  if (!normalized.startsWith(prefixText)) return false;
  String numberPart = normalized.substring(prefixText.length());
  numberPart.trim();
  uint32_t parsed = 0;
  if (!parseUnsignedLong(numberPart, parsed) || parsed < 1 || parsed > maxCount) return false;
  indexOut = static_cast<uint8_t>(parsed - 1U);
  return true;
}

bool parseVirtualInputToken(const String& token, uint8_t& indexOut) {
  return parseIndexedToken(token, "VIN", kChannelCount, indexOut);
}

int virtualInputIndexFromLabel(const String& label) {
  uint8_t index = 0;
  if (!parseVirtualInputToken(label, index)) return -1;
  return static_cast<int>(index);
}

bool parseOnOffToken(const String& token, bool& value) {
  String normalized = upperToken(token);
  if (normalized == "ON" || normalized == "1" || normalized == "TRUE") {
    value = true;
    return true;
  }
  if (normalized == "OFF" || normalized == "0" || normalized == "FALSE") {
    value = false;
    return true;
  }
  return false;
}

bool parseComparatorToken(const String& token, CustomComparator& comparator) {
  const String normalized = upperToken(token);
  if (normalized == "==") {
    comparator = CUSTOM_CMP_EQ;
    return true;
  }
  if (normalized == "!=") {
    comparator = CUSTOM_CMP_NE;
    return true;
  }
  if (normalized == ">") {
    comparator = CUSTOM_CMP_GT;
    return true;
  }
  if (normalized == ">=") {
    comparator = CUSTOM_CMP_GE;
    return true;
  }
  if (normalized == "<") {
    comparator = CUSTOM_CMP_LT;
    return true;
  }
  if (normalized == "<=") {
    comparator = CUSTOM_CMP_LE;
    return true;
  }
  return false;
}

bool parseThermostatModeToken(const String& token, CustomThermostatMode& mode) {
  const String normalized = upperToken(token);
  if (normalized == "AUTO") {
    mode = CUSTOM_TH_AUTO;
    return true;
  }
  if (normalized == "COOL" || normalized == "COOLING") {
    mode = CUSTOM_TH_COOL;
    return true;
  }
  if (normalized == "HEAT" || normalized == "HEATING") {
    mode = CUSTOM_TH_HEAT;
    return true;
  }
  return false;
}

bool evaluateCustomComparator(float left, float right, CustomComparator comparator) {
  switch (comparator) {
    case CUSTOM_CMP_EQ:
      return fabsf(left - right) <= 0.0001f;
    case CUSTOM_CMP_NE:
      return fabsf(left - right) > 0.0001f;
    case CUSTOM_CMP_GT:
      return left > right;
    case CUSTOM_CMP_GE:
      return left >= right;
    case CUSTOM_CMP_LT:
      return left < right;
    case CUSTOM_CMP_LE:
      return left <= right;
    default:
      return false;
  }
}

bool parseCustomConditionTokens(
    const String& sourceToken,
    const String& operatorToken,
    const String& valueToken,
    size_t lineNumber,
    CustomSignalType& signalOut,
    uint8_t& sourceIndexOut,
    CustomComparator& comparatorOut,
    float& thresholdOut) {
  if (!parseComparatorToken(operatorToken, comparatorOut)) {
    setCustomProgramError(lineNumber, "operador invalido en condicion");
    return false;
  }

  uint8_t parsedIndex = 0;
  if (parseIndexedToken(sourceToken, "TEMP", kChannelCount, parsedIndex)) {
    signalOut = CUSTOM_SIGNAL_TEMP;
    sourceIndexOut = parsedIndex;
    if (!parseFloatValue(valueToken, thresholdOut)) {
      setCustomProgramError(lineNumber, "valor invalido para condicion TEMP");
      return false;
    }
    return true;
  }

  if (parseIndexedToken(sourceToken, "HUM", kHumidityChannelCount, parsedIndex)) {
    signalOut = CUSTOM_SIGNAL_HUM;
    sourceIndexOut = parsedIndex;
    if (!parseFloatValue(valueToken, thresholdOut)) {
      setCustomProgramError(lineNumber, "valor invalido para condicion HUM");
      return false;
    }
    return true;
  }

  if (parseIndexedToken(sourceToken, "IN", kChannelCount, parsedIndex)) {
    bool expectedState = false;
    if (!parseOnOffToken(valueToken, expectedState)) {
      setCustomProgramError(lineNumber, "condicion IN espera ON u OFF");
      return false;
    }
    signalOut = CUSTOM_SIGNAL_INPUT;
    sourceIndexOut = parsedIndex;
    thresholdOut = expectedState ? 1.0f : 0.0f;
    return true;
  }

  setCustomProgramError(lineNumber, "fuente invalida en condicion (TEMPn, HUMn o INn)");
  return false;
}

bool readCustomSignalValue(CustomSignalType signal, uint8_t sourceIndex, float& valueOut) {
  if (signal == CUSTOM_SIGNAL_TEMP) {
    if (sourceIndex < kChannelCount && runtimeData.temperatureValid[sourceIndex]) {
      valueOut = runtimeData.temperature[sourceIndex];
      return true;
    }
    return false;
  }

  if (signal == CUSTOM_SIGNAL_HUM) {
    if (sourceIndex < kHumidityChannelCount && runtimeData.humidityValid[sourceIndex]) {
      valueOut = runtimeData.humidity[sourceIndex];
      return true;
    }
    return false;
  }

  if (signal == CUSTOM_SIGNAL_INPUT) {
    if (sourceIndex < kChannelCount) {
      valueOut = runtimeData.inputState[sourceIndex] ? 1.0f : 0.0f;
      return true;
    }
    return false;
  }

  return false;
}

bool parseCustomRuleLine(const String& rawLine, size_t lineNumber, CustomRule& ruleOut, bool& hasRule) {
  hasRule = false;

  String line = stripCustomLineComments(rawLine);
  if (!line.length() || line.startsWith("//")) return true;

  String tokens[12];
  const size_t tokenCount = tokenizeCustomLine(line, tokens, 12);
  if (!tokenCount) return true;

  const String command = upperToken(tokens[0]);
  CustomRule rule;

  if (command == "SET") {
    if (tokenCount != 3U) {
      setCustomProgramError(lineNumber, "SET requiere: SET RELn ON|OFF");
      return false;
    }
    if (!parseIndexedToken(tokens[1], "REL", kChannelCount, rule.relayIndex)) {
      setCustomProgramError(lineNumber, "relay invalido en SET");
      return false;
    }
    if (!parseOnOffToken(tokens[2], rule.actionState)) {
      setCustomProgramError(lineNumber, "SET espera ON u OFF");
      return false;
    }
    rule.type = CUSTOM_RULE_SET;
    ruleOut = rule;
    hasRule = true;
    return true;
  }

  if (command == "BLINK") {
    if (tokenCount != 3U && tokenCount != 4U) {
      setCustomProgramError(lineNumber, "BLINK requiere: BLINK RELn onMs [offMs]");
      return false;
    }
    if (!parseIndexedToken(tokens[1], "REL", kChannelCount, rule.relayIndex)) {
      setCustomProgramError(lineNumber, "relay invalido en BLINK");
      return false;
    }

    uint32_t onMs = 0;
    if (!parseUnsignedLong(tokens[2], onMs)) {
      setCustomProgramError(lineNumber, "BLINK onMs invalido");
      return false;
    }
    uint32_t offMs = onMs;
    if (tokenCount == 4U && !parseUnsignedLong(tokens[3], offMs)) {
      setCustomProgramError(lineNumber, "BLINK offMs invalido");
      return false;
    }

    if (onMs < kCustomBlinkMinMs || offMs < kCustomBlinkMinMs || onMs > kCustomBlinkMaxMs || offMs > kCustomBlinkMaxMs) {
      setCustomProgramError(lineNumber, "BLINK fuera de rango (50ms a 3600000ms)");
      return false;
    }

    rule.type = CUSTOM_RULE_BLINK;
    rule.onMs = onMs;
    rule.offMs = offMs;
    ruleOut = rule;
    hasRule = true;
    return true;
  }

  if (command == "THERMOSTAT") {
    if (tokenCount != 5U && tokenCount != 6U) {
      setCustomProgramError(lineNumber, "THERMOSTAT requiere: THERMOSTAT RELn TEMPm setpoint diff [AUTO|COOL|HEAT]");
      return false;
    }
    if (!parseIndexedToken(tokens[1], "REL", kChannelCount, rule.relayIndex)) {
      setCustomProgramError(lineNumber, "relay invalido en THERMOSTAT");
      return false;
    }
    if (!parseIndexedToken(tokens[2], "TEMP", kChannelCount, rule.sourceIndex)) {
      setCustomProgramError(lineNumber, "sensor invalido en THERMOSTAT (usa TEMP1..TEMP4)");
      return false;
    }
    if (!parseFloatValue(tokens[3], rule.setpoint) || !parseFloatValue(tokens[4], rule.differential)) {
      setCustomProgramError(lineNumber, "setpoint/diff invalidos en THERMOSTAT");
      return false;
    }
    if (rule.differential < 0.1f || rule.differential > 50.0f) {
      setCustomProgramError(lineNumber, "diff en THERMOSTAT fuera de rango (0.1..50.0)");
      return false;
    }
    if (tokenCount == 6U && !parseThermostatModeToken(tokens[5], rule.thermostatMode)) {
      setCustomProgramError(lineNumber, "modo de THERMOSTAT invalido");
      return false;
    }
    rule.type = CUSTOM_RULE_THERMOSTAT;
    ruleOut = rule;
    hasRule = true;
    return true;
  }

  if (command == "IF") {
    if (tokenCount != 7U) {
      setCustomProgramError(lineNumber, "IF requiere: IF fuente op valor THEN RELn ON|OFF");
      return false;
    }

    if (upperToken(tokens[4]) != "THEN") {
      setCustomProgramError(lineNumber, "IF requiere keyword THEN");
      return false;
    }
    if (!parseIndexedToken(tokens[5], "REL", kChannelCount, rule.relayIndex)) {
      setCustomProgramError(lineNumber, "relay invalido en IF");
      return false;
    }
    if (!parseOnOffToken(tokens[6], rule.actionState)) {
      setCustomProgramError(lineNumber, "IF espera accion ON u OFF");
      return false;
    }
    if (!parseCustomConditionTokens(tokens[1], tokens[2], tokens[3], lineNumber, rule.signal, rule.sourceIndex, rule.comparator, rule.threshold)) {
      return false;
    }

    rule.type = CUSTOM_RULE_IF;
    ruleOut = rule;
    hasRule = true;
    return true;
  }

  if (command == "IFALL" || command == "IFANY") {
    if (tokenCount != 10U) {
      setCustomProgramError(lineNumber, "IFALL/IFANY requiere: IFALL src1 op1 v1 src2 op2 v2 THEN RELn ON|OFF");
      return false;
    }
    if (upperToken(tokens[7]) != "THEN") {
      setCustomProgramError(lineNumber, "IFALL/IFANY requiere keyword THEN");
      return false;
    }
    if (!parseIndexedToken(tokens[8], "REL", kChannelCount, rule.relayIndex)) {
      setCustomProgramError(lineNumber, "relay invalido en IFALL/IFANY");
      return false;
    }
    if (!parseOnOffToken(tokens[9], rule.actionState)) {
      setCustomProgramError(lineNumber, "IFALL/IFANY espera accion ON u OFF");
      return false;
    }
    if (!parseCustomConditionTokens(tokens[1], tokens[2], tokens[3], lineNumber, rule.signal, rule.sourceIndex, rule.comparator, rule.threshold)) {
      return false;
    }
    if (!parseCustomConditionTokens(tokens[4], tokens[5], tokens[6], lineNumber, rule.signal2, rule.sourceIndex2, rule.comparator2, rule.threshold2)) {
      return false;
    }

    rule.type = command == "IFALL" ? CUSTOM_RULE_IFALL : CUSTOM_RULE_IFANY;
    ruleOut = rule;
    hasRule = true;
    return true;
  }

  if (command == "TIMER") {
    if (tokenCount != 4U) {
      setCustomProgramError(lineNumber, "TIMER requiere: TIMER RELn onMs offMs");
      return false;
    }
    if (!parseIndexedToken(tokens[1], "REL", kChannelCount, rule.relayIndex)) {
      setCustomProgramError(lineNumber, "relay invalido en TIMER");
      return false;
    }
    uint32_t onMs = 0;
    uint32_t offMs = 0;
    if (!parseUnsignedLong(tokens[2], onMs) || !parseUnsignedLong(tokens[3], offMs)) {
      setCustomProgramError(lineNumber, "TIMER on/off invalido");
      return false;
    }
    if (onMs < kCustomBlinkMinMs || offMs < kCustomBlinkMinMs || onMs > kCustomBlinkMaxMs || offMs > kCustomBlinkMaxMs) {
      setCustomProgramError(lineNumber, "TIMER fuera de rango (50ms a 3600000ms)");
      return false;
    }
    rule.type = CUSTOM_RULE_TIMER;
    rule.onMs = onMs;
    rule.offMs = offMs;
    ruleOut = rule;
    hasRule = true;
    return true;
  }

  if (command == "ONCHANGE") {
    if (tokenCount != 4U) {
      setCustomProgramError(lineNumber, "ONCHANGE requiere: ONCHANGE INn TOGGLE RELm");
      return false;
    }
    if (!parseIndexedToken(tokens[1], "IN", kChannelCount, rule.sourceIndex)) {
      setCustomProgramError(lineNumber, "entrada invalida en ONCHANGE");
      return false;
    }
    if (upperToken(tokens[2]) != "TOGGLE") {
      setCustomProgramError(lineNumber, "ONCHANGE solo soporta TOGGLE");
      return false;
    }
    if (!parseIndexedToken(tokens[3], "REL", kChannelCount, rule.relayIndex)) {
      setCustomProgramError(lineNumber, "relay invalido en ONCHANGE");
      return false;
    }
    rule.type = CUSTOM_RULE_ONCHANGE_TOGGLE;
    rule.signal = CUSTOM_SIGNAL_INPUT;
    ruleOut = rule;
    hasRule = true;
    return true;
  }

  if (command == "PULSE") {
    if (tokenCount != 5U && tokenCount != 6U) {
      setCustomProgramError(lineNumber, "PULSE requiere: PULSE INn RELm onMs count [gapMs]");
      return false;
    }
    if (!parseIndexedToken(tokens[1], "IN", kChannelCount, rule.sourceIndex)) {
      setCustomProgramError(lineNumber, "entrada invalida en PULSE");
      return false;
    }
    if (!parseIndexedToken(tokens[2], "REL", kChannelCount, rule.relayIndex)) {
      setCustomProgramError(lineNumber, "relay invalido en PULSE");
      return false;
    }

    uint32_t onMs = 0;
    uint32_t count = 0;
    uint32_t gapMs = 250;
    if (!parseUnsignedLong(tokens[3], onMs)) {
      setCustomProgramError(lineNumber, "PULSE onMs invalido");
      return false;
    }
    if (!parseUnsignedLong(tokens[4], count)) {
      setCustomProgramError(lineNumber, "PULSE count invalido");
      return false;
    }
    if (tokenCount == 6U && !parseUnsignedLong(tokens[5], gapMs)) {
      setCustomProgramError(lineNumber, "PULSE gapMs invalido");
      return false;
    }
    if (onMs < kCustomBlinkMinMs || onMs > kCustomBlinkMaxMs || gapMs < kCustomBlinkMinMs || gapMs > kCustomBlinkMaxMs) {
      setCustomProgramError(lineNumber, "PULSE fuera de rango (50ms a 3600000ms)");
      return false;
    }
    if (count < 1U || count > 20U) {
      setCustomProgramError(lineNumber, "PULSE count fuera de rango (1..20)");
      return false;
    }

    rule.type = CUSTOM_RULE_PULSE;
    rule.signal = CUSTOM_SIGNAL_INPUT;
    rule.onMs = onMs;
    rule.offMs = gapMs;
    rule.pulseCount = static_cast<uint8_t>(count);
    ruleOut = rule;
    hasRule = true;
    return true;
  }

  if (command == "ONBOOT") {
    if (tokenCount != 4U) {
      setCustomProgramError(lineNumber, "ONBOOT requiere: ONBOOT RELn delayMs onMs");
      return false;
    }
    if (!parseIndexedToken(tokens[1], "REL", kChannelCount, rule.relayIndex)) {
      setCustomProgramError(lineNumber, "relay invalido en ONBOOT");
      return false;
    }

    uint32_t delayMs = 0;
    uint32_t onMs = 0;
    if (!parseUnsignedLong(tokens[2], delayMs) || !parseUnsignedLong(tokens[3], onMs)) {
      setCustomProgramError(lineNumber, "ONBOOT delay/onMs invalido");
      return false;
    }
    if (delayMs < kCustomBlinkMinMs || delayMs > kCustomBlinkMaxMs || onMs < kCustomBlinkMinMs || onMs > kCustomBlinkMaxMs) {
      setCustomProgramError(lineNumber, "ONBOOT fuera de rango (50ms a 3600000ms)");
      return false;
    }

    rule.type = CUSTOM_RULE_ONBOOT;
    rule.offMs = delayMs;
    rule.onMs = onMs;
    ruleOut = rule;
    hasRule = true;
    return true;
  }

  setCustomProgramError(lineNumber, String("comando no soportado: ") + tokens[0]);
  return false;
}

bool parseSequenceConditionExpression(const String& rawExpression,
                                      size_t lineNumber,
                                      SequenceCondition& conditionOut,
                                      const char* errorPrefix) {
  String expression = rawExpression;
  expression.trim();
  if (!expression.length()) {
    setCustomProgramError(lineNumber, String(errorPrefix) + " condicion vacia");
    return false;
  }
  if (containsForbiddenExpressionChars(expression)) {
    setCustomProgramError(lineNumber, String(errorPrefix) + " condicion invalida");
    return false;
  }

  struct ComparatorToken {
    const char* token;
    CustomComparator comparator;
  };
  static constexpr ComparatorToken kComparators[] = {
    {"<=", CUSTOM_CMP_LE},
    {">=", CUSTOM_CMP_GE},
    {"==", CUSTOM_CMP_EQ},
    {"!=", CUSTOM_CMP_NE},
    {">", CUSTOM_CMP_GT},
    {"<", CUSTOM_CMP_LT},
  };

  int opPos = -1;
  size_t opLen = 0;
  CustomComparator comparator = CUSTOM_CMP_EQ;
  for (const ComparatorToken& candidate : kComparators) {
    const int found = expression.indexOf(candidate.token);
    if (found < 0) continue;
    opPos = found;
    opLen = strlen(candidate.token);
    comparator = candidate.comparator;
    break;
  }
  if (opPos <= 0 || opLen == 0) {
    setCustomProgramError(lineNumber, String(errorPrefix) + " operador invalido");
    return false;
  }

  String left = expression.substring(0, opPos);
  String right = expression.substring(opPos + static_cast<int>(opLen));
  left = upperToken(left);
  right.trim();
  if (!left.length() || !right.length()) {
    setCustomProgramError(lineNumber, String(errorPrefix) + " condicion incompleta");
    return false;
  }

  uint8_t index = 0;
  SequenceCondition condition;
  if (parseIndexedToken(left, "TEMP", kChannelCount, index)) {
    condition.signal = CUSTOM_SIGNAL_TEMP;
    condition.sourceIndex = index;
    if (!parseFloatValue(right, condition.threshold)) {
      setCustomProgramError(lineNumber, String(errorPrefix) + " VALUE invalido");
      return false;
    }
  } else if (parseIndexedToken(left, "HUM", kHumidityChannelCount, index)) {
    condition.signal = CUSTOM_SIGNAL_HUM;
    condition.sourceIndex = index;
    if (!parseFloatValue(right, condition.threshold)) {
      setCustomProgramError(lineNumber, String(errorPrefix) + " VALUE invalido");
      return false;
    }
  } else if (parseIndexedToken(left, "IN", kChannelCount, index)) {
    bool state = false;
    if (!parseOnOffToken(right, state)) {
      setCustomProgramError(lineNumber, String(errorPrefix) + " VALUE invalido");
      return false;
    }
    condition.signal = CUSTOM_SIGNAL_INPUT;
    condition.sourceIndex = index;
    condition.threshold = state ? 1.0f : 0.0f;
  } else {
    setCustomProgramError(lineNumber, String(errorPrefix) + " fuente invalida");
    return false;
  }

  condition.comparator = comparator;
  condition.valid = true;
  conditionOut = condition;
  return true;
}

bool evaluateSequenceCondition(const SequenceCondition& condition, float& observedValue) {
  if (!condition.valid) return false;
  if (!readCustomSignalValue(condition.signal, condition.sourceIndex, observedValue)) return false;
  return evaluateCustomComparator(observedValue, condition.threshold, condition.comparator);
}

bool parseSequenceStepSet(const String* tokens,
                          size_t tokenCount,
                          size_t lineNumber,
                          SequenceProgramRuntime& sequence,
                          bool timedStepAllowed) {
  uint8_t relayIndex = 0;
  bool state = false;
  bool hasRelay = false;
  bool hasState = false;
  bool hasTime = false;
  uint32_t timeMs = 0;

  for (size_t index = 1; index < tokenCount; ++index) {
    String key;
    String value;
    if (!parseKeyValueToken(tokens[index], key, value)) {
      setCustomProgramError(lineNumber, "token clave=valor invalido");
      return false;
    }

    if (key == "REL") {
      if (!parseIndexedToken(value, "REL", kChannelCount, relayIndex)) {
        setCustomProgramError(lineNumber, "REL invalido");
        return false;
      }
      hasRelay = true;
      continue;
    }
    if (key == "STATE") {
      if (!parseOnOffToken(value, state)) {
        setCustomProgramError(lineNumber, "STATE invalido");
        return false;
      }
      hasState = true;
      continue;
    }
    if (key == "TIME" && timedStepAllowed) {
      if (!parseUnsignedLong(value, timeMs)) {
        setCustomProgramError(lineNumber, "TIME invalido");
        return false;
      }
      if (timeMs < kSequenceTimeMinMs || timeMs > kSequenceTimeMaxMs) {
        setCustomProgramError(lineNumber, "TIME fuera de rango");
        return false;
      }
      hasTime = true;
      continue;
    }

    setCustomProgramError(lineNumber, String("clave no soportada: ") + key);
    return false;
  }

  if (!hasRelay) {
    setCustomProgramError(lineNumber, "falta REL");
    return false;
  }
  if (!hasState) {
    setCustomProgramError(lineNumber, "falta STATE");
    return false;
  }

  if (sequence.stepCount >= kSequenceMaxSteps) {
    setCustomProgramError(lineNumber, "se superan pasos maximos");
    return false;
  }

  SequenceStep& step = sequence.steps[sequence.stepCount++];
  step = SequenceStep();
  step.type = timedStepAllowed ? SEQ_STEP_STEP : SEQ_STEP_SET;
  step.relayIndex = relayIndex;
  step.relayState = state;
  step.hasDuration = hasTime;
  step.durationMs = hasTime ? timeMs : 0U;
  step.lineNumber = lineNumber;

  sequence.usedRelayMask |= static_cast<uint8_t>(1U << relayIndex);
  sequence.reservedRelayMask = sequence.usedRelayMask;
  return true;
}

bool parseSequenceWait(const String* tokens,
                       size_t tokenCount,
                       size_t lineNumber,
                       SequenceProgramRuntime& sequence) {
  bool hasTime = false;
  uint32_t timeMs = 0;
  for (size_t index = 1; index < tokenCount; ++index) {
    String key;
    String value;
    if (!parseKeyValueToken(tokens[index], key, value)) {
      setCustomProgramError(lineNumber, "token clave=valor invalido");
      return false;
    }
    if (key != "TIME") {
      setCustomProgramError(lineNumber, String("clave no soportada: ") + key);
      return false;
    }
    if (!parseUnsignedLong(value, timeMs)) {
      setCustomProgramError(lineNumber, "TIME invalido");
      return false;
    }
    if (timeMs < kSequenceTimeMinMs || timeMs > kSequenceTimeMaxMs) {
      setCustomProgramError(lineNumber, "TIME fuera de rango");
      return false;
    }
    hasTime = true;
  }
  if (!hasTime) {
    setCustomProgramError(lineNumber, "WAIT requiere TIME");
    return false;
  }

  if (sequence.stepCount >= kSequenceMaxSteps) {
    setCustomProgramError(lineNumber, "se superan pasos maximos");
    return false;
  }

  SequenceStep& step = sequence.steps[sequence.stepCount++];
  step = SequenceStep();
  step.type = SEQ_STEP_WAIT;
  step.durationMs = timeMs;
  step.lineNumber = lineNumber;
  return true;
}

bool parseSequenceWaitUntil(const String* tokens,
                            size_t tokenCount,
                            size_t lineNumber,
                            SequenceProgramRuntime& sequence) {
  String sourceToken;
  CustomSignalType expectedSignal = CUSTOM_SIGNAL_TEMP;
  bool sourceDefined = false;
  String operatorToken;
  bool operatorDefined = false;
  String valueToken;
  bool valueDefined = false;
  uint32_t stableMs = 0;
  uint32_t maxMs = 0;
  bool stableDefined = false;
  bool maxDefined = false;

  for (size_t index = 1; index < tokenCount; ++index) {
    String key;
    String value;
    if (!parseKeyValueToken(tokens[index], key, value)) {
      setCustomProgramError(lineNumber, "token clave=valor invalido");
      return false;
    }
    if (key == "TEMP" || key == "HUM" || key == "IN") {
      if (sourceDefined) {
        setCustomProgramError(lineNumber, "WAITUNTIL solo admite una fuente");
        return false;
      }
      sourceDefined = true;
      if (key == "TEMP") expectedSignal = CUSTOM_SIGNAL_TEMP;
      else if (key == "HUM") expectedSignal = CUSTOM_SIGNAL_HUM;
      else expectedSignal = CUSTOM_SIGNAL_INPUT;
      sourceToken = upperToken(value);
      continue;
    }
    if (key == "OP") {
      operatorDefined = true;
      operatorToken = value;
      continue;
    }
    if (key == "VALUE") {
      valueDefined = true;
      valueToken = value;
      continue;
    }
    if (key == "STABLE") {
      if (!parseUnsignedLong(value, stableMs)) {
        setCustomProgramError(lineNumber, "STABLE invalido");
        return false;
      }
      if (stableMs < kSequenceTimeMinMs || stableMs > kSequenceTimeMaxMs) {
        setCustomProgramError(lineNumber, "STABLE fuera de rango");
        return false;
      }
      stableDefined = true;
      continue;
    }
    if (key == "MAX") {
      if (!parseUnsignedLong(value, maxMs)) {
        setCustomProgramError(lineNumber, "MAX invalido");
        return false;
      }
      if (maxMs < kSequenceTimeMinMs || maxMs > kSequenceTimeMaxMs) {
        setCustomProgramError(lineNumber, "MAX fuera de rango");
        return false;
      }
      maxDefined = true;
      continue;
    }
    setCustomProgramError(lineNumber, String("clave no soportada: ") + key);
    return false;
  }

  if (!sourceDefined || !operatorDefined || !valueDefined || !stableDefined || !maxDefined) {
    setCustomProgramError(lineNumber, "WAITUNTIL requiere TEMP/HUM/IN, OP, VALUE, STABLE y MAX");
    return false;
  }

  String expression = sourceToken + operatorToken + valueToken;
  SequenceCondition condition;
  if (!parseSequenceConditionExpression(expression, lineNumber, condition, "WAITUNTIL")) {
    return false;
  }

  if (condition.signal != expectedSignal) {
    setCustomProgramError(lineNumber, "WAITUNTIL fuente no coincide con clave");
    return false;
  }

  if (sequence.stepCount >= kSequenceMaxSteps) {
    setCustomProgramError(lineNumber, "se superan pasos maximos");
    return false;
  }

  SequenceStep& step = sequence.steps[sequence.stepCount++];
  step = SequenceStep();
  step.type = SEQ_STEP_WAITUNTIL;
  step.condition = condition;
  step.stableMs = stableMs;
  step.maxMs = maxMs;
  step.lineNumber = lineNumber;
  return true;
}

bool readSequenceInputSignal(bool usesVirtualInput, uint8_t inputIndex) {
  if (inputIndex >= kChannelCount) return false;
  return usesVirtualInput ? runtimeData.virtualInputState[inputIndex] : runtimeData.inputState[inputIndex];
}

uint8_t readSequenceInputMask(bool usesVirtualInput) {
  uint8_t mask = 0;
  for (uint8_t index = 0; index < kChannelCount; ++index) {
    const bool state = usesVirtualInput ? runtimeData.virtualInputState[index] : runtimeData.inputState[index];
    if (state) mask = static_cast<uint8_t>(mask | static_cast<uint8_t>(1U << index));
  }
  return mask;
}

bool sequenceHasStartSources(const SequenceProgramRuntime& sequence) {
  return static_cast<uint8_t>(sequence.startPhysicalMask | sequence.startVirtualMask) != 0U;
}

void cancelOnbootPendingForSequenceRelays() {
  const uint8_t reservedMask = gCustomProgram.sequence.reservedRelayMask;
  if (!reservedMask) return;
  for (size_t index = 0; index < gCustomProgram.ruleCount; ++index) {
    const CustomRule& rule = gCustomProgram.rules[index];
    if (rule.type != CUSTOM_RULE_ONBOOT) continue;
    if (rule.relayIndex >= kChannelCount) continue;
    if ((reservedMask & static_cast<uint8_t>(1U << rule.relayIndex)) == 0U) continue;
    gCustomProgram.onbootActive[index] = false;
    gCustomProgram.onbootDone[index] = true;
  }
}

void sequenceStopAndRelease(SequenceProgramRuntime& sequence, bool* target, SequenceState nextState) {
  sequence.running = false;
  sequence.state = nextState;
  sequence.stepStartedAt = 0;
  sequence.loopStartedAt = 0;
  sequence.stableStartedAt = 0;
  sequence.stableArmed = false;
  sequence.currentStep = 0;
  sequence.currentLoop = 0;
  sequence.previousStepWithDuration = 0xFFU;
  sequence.previousStepAutoOffPending = false;
  for (size_t index = 0; index < kChannelCount; ++index) {
    if ((sequence.reservedRelayMask & static_cast<uint8_t>(1U << index)) != 0U) {
      target[index] = false;
    }
  }
}

void processSequenceProgram(uint32_t now, bool* target) {
  SequenceProgramRuntime& sequence = gCustomProgram.sequence;
  if (!sequence.present || !sequence.valid) return;
  if (!sequence.startDefined || !sequenceHasStartSources(sequence)) return;

  const uint8_t startPhysicalMask = static_cast<uint8_t>(readSequenceInputMask(false) & sequence.startPhysicalMask);
  const uint8_t startVirtualMask = static_cast<uint8_t>(readSequenceInputMask(true) & sequence.startVirtualMask);
  if (!sequence.startEdgeArmed) {
    sequence.startEdgeArmed = true;
    sequence.startLastPhysicalMask = startPhysicalMask;
    sequence.startLastVirtualMask = startVirtualMask;
    if (!sequence.running &&
        (sequence.state == SEQ_STATE_IDLE ||
         sequence.state == SEQ_STATE_ABORTED_AFTER_REBOOT ||
         sequence.state == SEQ_STATE_DONE ||
         sequence.state == SEQ_STATE_ABORTED ||
         sequence.state == SEQ_STATE_SAFETY_STOP)) {
      sequence.state = SEQ_STATE_READY;
    }
  }

  const uint8_t startPhysicalRising =
      static_cast<uint8_t>(startPhysicalMask & static_cast<uint8_t>(~sequence.startLastPhysicalMask));
  const uint8_t startVirtualRising =
      static_cast<uint8_t>(startVirtualMask & static_cast<uint8_t>(~sequence.startLastVirtualMask));
  if (!sequence.running && (startPhysicalRising != 0U || startVirtualRising != 0U)) {
    sequence.running = true;
    sequence.state = SEQ_STATE_RUNNING;
    sequence.currentStep = 0;
    sequence.currentLoop = 0;
    sequence.stepStartedAt = 0;
    sequence.loopStartedAt = 0;
    sequence.stableStartedAt = 0;
    sequence.stableArmed = false;
    sequence.previousStepWithDuration = 0xFFU;
    sequence.previousStepAutoOffPending = false;
    cancelOnbootPendingForSequenceRelays();
    addLog("Sequence start: %s", sequence.name[0] ? sequence.name : "PROGRAM");
  }
  sequence.startLastPhysicalMask = startPhysicalMask;
  sequence.startLastVirtualMask = startVirtualMask;

  if (!sequence.running) return;

  if (sequence.safetyDefined && readSequenceInputSignal(sequence.safetyUsesVirtualInput, sequence.safetyInputIndex)) {
    for (size_t index = 0; index < kChannelCount; ++index) {
      target[index] = false;
    }
    sequenceStopAndRelease(sequence, target, SEQ_STATE_SAFETY_STOP);
    addLog("Sequence safety stop: %s%u",
           sequence.safetyUsesVirtualInput ? "VIN" : "IN",
           static_cast<unsigned>(sequence.safetyInputIndex + 1U));
    return;
  }

  if (sequence.previousStepAutoOffPending && sequence.previousStepWithDuration < kChannelCount) {
    target[sequence.previousStepWithDuration] = false;
    sequence.previousStepAutoOffPending = false;
    sequence.previousStepWithDuration = 0xFFU;
  }

  if (sequence.currentStep >= sequence.stepCount) {
    sequenceStopAndRelease(sequence, target, SEQ_STATE_DONE);
    addLog("Sequence done");
    return;
  }

  SequenceStep& step = sequence.steps[sequence.currentStep];
  switch (step.type) {
    case SEQ_STEP_SET:
      target[step.relayIndex] = step.relayState;
      sequence.currentStep++;
      sequence.state = SEQ_STATE_RUNNING;
      break;

    case SEQ_STEP_STEP:
      if (!step.hasDuration) {
        target[step.relayIndex] = step.relayState;
        sequence.currentStep++;
        sequence.state = SEQ_STATE_RUNNING;
        break;
      }
      if (!sequence.stepStartedAt) sequence.stepStartedAt = now;
      target[step.relayIndex] = step.relayState;
      sequence.state = SEQ_STATE_RUNNING;
      if (elapsedSince(now, sequence.stepStartedAt, step.durationMs)) {
        sequence.stepStartedAt = 0;
        sequence.currentStep++;
        if (step.relayState) {
          sequence.previousStepWithDuration = step.relayIndex;
          sequence.previousStepAutoOffPending = true;
        }
      }
      break;

    case SEQ_STEP_WAIT:
      if (!sequence.stepStartedAt) sequence.stepStartedAt = now;
      sequence.state = SEQ_STATE_WAITING;
      if (elapsedSince(now, sequence.stepStartedAt, step.durationMs)) {
        sequence.stepStartedAt = 0;
        sequence.currentStep++;
      }
      break;

    case SEQ_STEP_WAITUNTIL: {
      if (!sequence.stepStartedAt) sequence.stepStartedAt = now;
      sequence.state = SEQ_STATE_WAITING;

      float observed = NAN;
      const bool conditionMet = evaluateSequenceCondition(step.condition, observed);
      if (step.condition.signal == CUSTOM_SIGNAL_TEMP && !isnan(observed)) {
        sequence.lastTemperature = observed;
      }

      if (conditionMet) {
        if (!sequence.stableArmed) {
          sequence.stableArmed = true;
          sequence.stableStartedAt = now;
        } else if (elapsedSince(now, sequence.stableStartedAt, step.stableMs)) {
          sequence.stepStartedAt = 0;
          sequence.stableArmed = false;
          sequence.stableStartedAt = 0;
          sequence.currentStep++;
        }
      } else {
        sequence.stableArmed = false;
        sequence.stableStartedAt = 0;
      }

      if (sequence.running && step.maxMs && elapsedSince(now, sequence.stepStartedAt, step.maxMs)) {
        setSequenceRuntimeError(step.lineNumber ? step.lineNumber : 0U, "WAITUNTIL timeout MAX");
        sequenceStopAndRelease(sequence, target, SEQ_STATE_ERROR);
      }
      break;
    }

    default:
      break;
  }

  if (!sequence.running) return;

  if (!sequence.loop.enabled) return;
  if (!sequence.stepCount) return;
  if (sequence.currentStep != sequence.loop.endStep + 1U) return;

  float observed = NAN;
  const bool untilMet = evaluateSequenceCondition(sequence.loop.untilCondition, observed);
  if (sequence.loop.untilCondition.signal == CUSTOM_SIGNAL_TEMP && !isnan(observed)) {
    sequence.lastTemperature = observed;
  }

  if (untilMet) {
    if (!sequence.stableArmed) {
      sequence.stableArmed = true;
      sequence.stableStartedAt = now;
    } else if (elapsedSince(now, sequence.stableStartedAt, sequence.loop.stableMs)) {
      sequence.currentStep = sequence.loop.endStep + 1U;
      sequence.stableArmed = false;
      sequence.stableStartedAt = 0;
      sequence.state = SEQ_STATE_RUNNING;
      return;
    }
  } else {
    sequence.stableArmed = false;
    sequence.stableStartedAt = 0;
  }

  if (sequence.currentLoop + 1U >= sequence.loop.maxIterations) {
    setSequenceRuntimeError(sequence.loop.lineNumber ? sequence.loop.lineNumber : 0U, "LOOP alcanzado MAX");
    sequenceStopAndRelease(sequence, target, SEQ_STATE_ERROR);
    return;
  }

  sequence.currentLoop++;
  sequence.currentStep = sequence.loop.beginStep;
  sequence.stepStartedAt = 0;
  sequence.state = SEQ_STATE_LOOPING;
  sequence.loopStartedAt = now;
}

void recompileCustomProgramFromConfig() {
  resetCustomProgramRuntime();

  String program = String(config().customProgram);
  program.replace("\r", "");
  program.trim();
  if (!program.length()) {
    setCustomProgramError(0, "customProgram vacio");
    return;
  }

  SequenceProgramRuntime& sequence = gCustomProgram.sequence;
  size_t lineNumber = 1U;
  int start = 0;
  bool inProgram = false;
  bool seenProgram = false;
  bool seenProgramEnd = false;
  bool loopOpen = false;
  bool loopSeen = false;
  uint8_t loopBeginStep = 0;

  while (start <= program.length()) {
    const int nextLine = program.indexOf('\n', start);
    const String rawLine = (nextLine >= 0) ? program.substring(start, nextLine) : program.substring(start);
    const String line = stripCustomLineComments(rawLine);

    if (line.length()) {
      String tokens[16];
      const size_t tokenCount = tokenizeCustomLine(line, tokens, 16);
      if (tokenCount) {
        const String command = upperToken(tokens[0]);

        if (inProgram) {
          sequence.sourceLineCount++;
          if (sequence.sourceLineCount > kSequenceMaxProgramLines) {
            setCustomProgramError(lineNumber, "PROGRAM supera 32 lineas");
            return;
          }

          if (command == "END") {
            if (loopOpen) {
              setCustomProgramError(lineNumber, "LOOP sin ENDLOOP");
              return;
            }
            inProgram = false;
            seenProgramEnd = true;
          } else if (command == "START") {
            bool hasInput = false;
            bool usesVirtualInput = false;
            uint8_t inputIndex = 0;
            for (size_t index = 1; index < tokenCount; ++index) {
              String key;
              String value;
              if (!parseKeyValueToken(tokens[index], key, value)) {
                setCustomProgramError(lineNumber, "START invalido");
                return;
              }
              if (key == "IN") {
                if (hasInput) {
                  setCustomProgramError(lineNumber, "START solo admite una entrada por linea");
                  return;
                }
                if (!parseIndexedToken(value, "IN", kChannelCount, inputIndex)) {
                  setCustomProgramError(lineNumber, "START IN invalido");
                  return;
                }
                hasInput = true;
                usesVirtualInput = false;
                continue;
              }
              if (key == "VIN") {
                if (hasInput) {
                  setCustomProgramError(lineNumber, "START solo admite una entrada por linea");
                  return;
                }
                if (!parseVirtualInputToken(value, inputIndex)) {
                  setCustomProgramError(lineNumber, "START VIN invalido");
                  return;
                }
                hasInput = true;
                usesVirtualInput = true;
                continue;
              }
              setCustomProgramError(lineNumber, String("clave no soportada: ") + key);
              return;
            }
            if (!hasInput) {
              setCustomProgramError(lineNumber, "START requiere IN o VIN");
              return;
            }
            const uint8_t bitMask = static_cast<uint8_t>(1U << inputIndex);
            if (usesVirtualInput) sequence.startVirtualMask = static_cast<uint8_t>(sequence.startVirtualMask | bitMask);
            else sequence.startPhysicalMask = static_cast<uint8_t>(sequence.startPhysicalMask | bitMask);
            sequence.startDefined = true;
          } else if (command == "SET") {
            if (!parseSequenceStepSet(tokens, tokenCount, lineNumber, sequence, false)) return;
          } else if (command == "STEP") {
            if (!parseSequenceStepSet(tokens, tokenCount, lineNumber, sequence, true)) return;
          } else if (command == "WAIT") {
            if (!parseSequenceWait(tokens, tokenCount, lineNumber, sequence)) return;
          } else if (command == "WAITUNTIL") {
            if (!parseSequenceWaitUntil(tokens, tokenCount, lineNumber, sequence)) return;
          } else if (command == "LOOP") {
            if (loopSeen) {
              setCustomProgramError(lineNumber, "mas de 1 LOOP no permitido");
              return;
            }
            if (loopOpen) {
              setCustomProgramError(lineNumber, "LOOP anidado no permitido");
              return;
            }

            bool maxDefined = false;
            bool untilDefined = false;
            bool stableDefined = false;
            uint32_t maxIterations = 0;
            String untilExpression;
            uint32_t stableMs = 0;

            for (size_t index = 1; index < tokenCount; ++index) {
              String key;
              String value;
              if (!parseKeyValueToken(tokens[index], key, value)) {
                setCustomProgramError(lineNumber, "LOOP invalido");
                return;
              }
              if (key == "MAX") {
                if (!parseUnsignedLong(value, maxIterations)) {
                  setCustomProgramError(lineNumber, "LOOP MAX invalido");
                  return;
                }
                if (maxIterations < 1U || maxIterations > kSequenceMaxLoopIterations) {
                  setCustomProgramError(lineNumber, "LOOP MAX fuera de rango");
                  return;
                }
                maxDefined = true;
                continue;
              }
              if (key == "UNTIL") {
                untilExpression = value;
                untilDefined = true;
                continue;
              }
              if (key == "STABLE") {
                if (!parseUnsignedLong(value, stableMs)) {
                  setCustomProgramError(lineNumber, "LOOP STABLE invalido");
                  return;
                }
                if (stableMs < kSequenceTimeMinMs || stableMs > kSequenceTimeMaxMs) {
                  setCustomProgramError(lineNumber, "LOOP STABLE fuera de rango");
                  return;
                }
                stableDefined = true;
                continue;
              }
              setCustomProgramError(lineNumber, String("clave no soportada: ") + key);
              return;
            }

            if (!maxDefined || !untilDefined || !stableDefined) {
              setCustomProgramError(lineNumber, "LOOP requiere MAX, UNTIL y STABLE");
              return;
            }

            SequenceCondition untilCondition;
            if (!parseSequenceConditionExpression(untilExpression, lineNumber, untilCondition, "LOOP")) {
              return;
            }

            loopSeen = true;
            loopOpen = true;
            loopBeginStep = sequence.stepCount;
            sequence.loop.enabled = true;
            sequence.loop.beginStep = loopBeginStep;
            sequence.loop.maxIterations = static_cast<uint8_t>(maxIterations);
            sequence.loop.untilCondition = untilCondition;
            sequence.loop.stableMs = stableMs;
            sequence.loop.lineNumber = lineNumber;
          } else if (command == "ENDLOOP") {
            if (!loopOpen) {
              setCustomProgramError(lineNumber, "ENDLOOP sin LOOP");
              return;
            }
            if (sequence.stepCount == loopBeginStep) {
              setCustomProgramError(lineNumber, "LOOP vacio");
              return;
            }
            sequence.loop.endStep = static_cast<uint8_t>(sequence.stepCount - 1U);
            loopOpen = false;
          } else if (command == "SAFETY") {
            bool hasInput = false;
            bool usesVirtualInput = false;
            bool hasAction = false;
            uint8_t inputIndex = 0;
            for (size_t index = 1; index < tokenCount; ++index) {
              String key;
              String value;
              if (!parseKeyValueToken(tokens[index], key, value)) {
                setCustomProgramError(lineNumber, "SAFETY invalido");
                return;
              }
              if (key == "IN") {
                if (hasInput) {
                  setCustomProgramError(lineNumber, "SAFETY solo admite una entrada");
                  return;
                }
                if (!parseIndexedToken(value, "IN", kChannelCount, inputIndex)) {
                  setCustomProgramError(lineNumber, "SAFETY IN invalido");
                  return;
                }
                hasInput = true;
                usesVirtualInput = false;
                continue;
              }
              if (key == "VIN") {
                if (hasInput) {
                  setCustomProgramError(lineNumber, "SAFETY solo admite una entrada");
                  return;
                }
                if (!parseVirtualInputToken(value, inputIndex)) {
                  setCustomProgramError(lineNumber, "SAFETY VIN invalido");
                  return;
                }
                hasInput = true;
                usesVirtualInput = true;
                continue;
              }
              if (key == "ACTION") {
                if (upperToken(value) != "ALL_OFF") {
                  setCustomProgramError(lineNumber, "SAFETY ACTION invalida");
                  return;
                }
                hasAction = true;
                continue;
              }
              setCustomProgramError(lineNumber, String("clave no soportada: ") + key);
              return;
            }
            if (!hasInput || !hasAction) {
              setCustomProgramError(lineNumber, "SAFETY requiere IN|VIN y ACTION");
              return;
            }
            sequence.safetyDefined = true;
            sequence.safetyInputIndex = inputIndex;
            sequence.safetyUsesVirtualInput = usesVirtualInput;
          } else if (command == "PROGRAM") {
            setCustomProgramError(lineNumber, "mas de 1 PROGRAM no permitido");
            return;
          } else {
            setCustomProgramError(lineNumber, String("comando desconocido en PROGRAM: ") + command);
            return;
          }
        } else {
          if (command == "PROGRAM") {
            if (seenProgram) {
              setCustomProgramError(lineNumber, "mas de 1 PROGRAM no permitido");
              return;
            }
            bool foundName = false;
            String programName;
            for (size_t index = 1; index < tokenCount; ++index) {
              String key;
              String value;
              if (!parseKeyValueToken(tokens[index], key, value)) {
                setCustomProgramError(lineNumber, "PROGRAM invalido");
                return;
              }
              if (key != "NAME") {
                setCustomProgramError(lineNumber, String("clave no soportada: ") + key);
                return;
              }
              if (!isSimpleProgramName(value)) {
                setCustomProgramError(lineNumber, "PROGRAM NAME invalido");
                return;
              }
              foundName = true;
              programName = value;
            }
            if (!foundName) {
              setCustomProgramError(lineNumber, "PROGRAM requiere NAME");
              return;
            }
            seenProgram = true;
            inProgram = true;
            sequence.present = true;
            sequence.sourceLineCount = 1U;
            strlcpy(sequence.name, programName.c_str(), sizeof(sequence.name));
          } else if (command == "END" || command == "ENDLOOP" || command == "LOOP" ||
                     command == "START" || command == "STEP" || command == "WAIT" ||
                     command == "WAITUNTIL" || command == "SAFETY") {
            setCustomProgramError(lineNumber, "bloque PROGRAM invalido");
            return;
          } else {
            CustomRule rule;
            bool hasRule = false;
            if (!parseCustomRuleLine(line, lineNumber, rule, hasRule)) {
              return;
            }
            if (hasRule) {
              if (gCustomProgram.ruleCount >= kCustomMaxRules) {
                setCustomProgramError(lineNumber, "se excedio el maximo de reglas (24)");
                return;
              }
              gCustomProgram.rules[gCustomProgram.ruleCount++] = rule;
            }
          }
        }
      }
    }

    if (nextLine < 0) break;
    start = nextLine + 1;
    ++lineNumber;
  }

  if (inProgram) {
    setCustomProgramError(lineNumber, "falta END");
    return;
  }
  if (loopOpen) {
    setCustomProgramError(lineNumber, "LOOP sin ENDLOOP");
    return;
  }
  if (seenProgram && !seenProgramEnd) {
    setCustomProgramError(lineNumber, "PROGRAM sin END");
    return;
  }

  if (sequence.present) {
    if (!sequence.startDefined) {
      setCustomProgramError(0, "PROGRAM sin START valido");
      return;
    }
    if (!sequence.stepCount) {
      setCustomProgramError(0, "PROGRAM sin pasos");
      return;
    }
    sequence.valid = true;
    sequence.running = false;
    sequence.state = SEQ_STATE_READY;
    sequence.startEdgeArmed = false;
    sequence.stepStartedAt = 0;
    sequence.stableStartedAt = 0;
    sequence.stableArmed = false;
    gCustomProgram.sequenceStepCount = sequence.stepCount;
  }

  if (!gCustomProgram.ruleCount && !sequence.present) {
    setCustomProgramError(0, "customProgram sin reglas activas");
    return;
  }

  if (sequence.present && gCustomProgram.ruleCount) gCustomProgram.mode = CUSTOM_PROGRAM_MIXED;
  else if (sequence.present) gCustomProgram.mode = CUSTOM_PROGRAM_SEQUENCE;
  else gCustomProgram.mode = CUSTOM_PROGRAM_RULES;

  gCustomProgram.valid = true;
  gCustomProgram.error[0] = '\0';
  gCustomProgram.sequence.errorMessage[0] = '\0';
  gCustomProgram.sequence.errorLine = 0;
  gCustomExecutionPrimed = false;
  addLog("Custom program compiled: %u rules, %u seq-steps (%s)",
         static_cast<unsigned>(gCustomProgram.ruleCount),
         static_cast<unsigned>(gCustomProgram.sequenceStepCount),
         customProgramModeLabel(gCustomProgram.mode));
}

bool isSequenceRelayReserved(size_t relayIndex) {
  if (relayIndex >= kChannelCount) return false;
  if (!gCustomProgram.sequence.present || !gCustomProgram.sequence.valid) return false;
  if (!gCustomProgram.sequence.running) return false;
  return (gCustomProgram.sequence.reservedRelayMask & static_cast<uint8_t>(1U << relayIndex)) != 0U;
}

void applyLegacyCustomRules(uint32_t now, bool* target) {
  for (size_t index = 0; index < gCustomProgram.ruleCount; ++index) {
    const CustomRule& rule = gCustomProgram.rules[index];
    if (rule.relayIndex >= kChannelCount) continue;
    if (isSequenceRelayReserved(rule.relayIndex)) continue;

    switch (rule.type) {
      case CUSTOM_RULE_SET:
        target[rule.relayIndex] = rule.actionState;
        break;

      case CUSTOM_RULE_BLINK: {
        const uint32_t stepMs = gCustomProgram.blinkState[index] ? rule.onMs : rule.offMs;
        if (elapsedSince(now, gCustomProgram.blinkAt[index], stepMs)) {
          gCustomProgram.blinkState[index] = !gCustomProgram.blinkState[index];
          gCustomProgram.blinkAt[index] = now;
        }
        target[rule.relayIndex] = gCustomProgram.blinkState[index];
        break;
      }

      case CUSTOM_RULE_TIMER: {
        const uint32_t stepMs = gCustomProgram.blinkState[index] ? rule.onMs : rule.offMs;
        if (elapsedSince(now, gCustomProgram.blinkAt[index], stepMs)) {
          gCustomProgram.blinkState[index] = !gCustomProgram.blinkState[index];
          gCustomProgram.blinkAt[index] = now;
        }
        target[rule.relayIndex] = gCustomProgram.blinkState[index];
        break;
      }

      case CUSTOM_RULE_IF: {
        float sourceValue = 0.0f;
        if (readCustomSignalValue(rule.signal, rule.sourceIndex, sourceValue)
            && evaluateCustomComparator(sourceValue, rule.threshold, rule.comparator)) {
          target[rule.relayIndex] = rule.actionState;
        }
        break;
      }

      case CUSTOM_RULE_IFALL:
      case CUSTOM_RULE_IFANY: {
        float leftValue = 0.0f;
        float rightValue = 0.0f;
        const bool leftOk = readCustomSignalValue(rule.signal, rule.sourceIndex, leftValue)
          && evaluateCustomComparator(leftValue, rule.threshold, rule.comparator);
        const bool rightOk = readCustomSignalValue(rule.signal2, rule.sourceIndex2, rightValue)
          && evaluateCustomComparator(rightValue, rule.threshold2, rule.comparator2);
        const bool result = (rule.type == CUSTOM_RULE_IFALL) ? (leftOk && rightOk) : (leftOk || rightOk);
        if (result) target[rule.relayIndex] = rule.actionState;
        break;
      }

      case CUSTOM_RULE_ONCHANGE_TOGGLE: {
        if (rule.sourceIndex >= kChannelCount) break;
        const bool inputNow = runtimeData.inputState[rule.sourceIndex];
        if (!gCustomProgram.edgeArmed[index]) {
          gCustomProgram.edgeArmed[index] = true;
          gCustomProgram.edgeLastInput[index] = inputNow;
        } else if (inputNow != gCustomProgram.edgeLastInput[index]) {
          gCustomProgram.edgeLastInput[index] = inputNow;
          target[rule.relayIndex] = !target[rule.relayIndex];
        }
        break;
      }

      case CUSTOM_RULE_PULSE: {
        if (rule.sourceIndex >= kChannelCount) break;
        const bool inputNow = runtimeData.inputState[rule.sourceIndex];
        if (!gCustomProgram.edgeArmed[index]) {
          gCustomProgram.edgeArmed[index] = true;
          gCustomProgram.edgeLastInput[index] = inputNow;
        } else if (inputNow != gCustomProgram.edgeLastInput[index]) {
          const bool risingEdge = inputNow;
          gCustomProgram.edgeLastInput[index] = inputNow;
          if (risingEdge) {
            gCustomProgram.pulseActive[index] = true;
            gCustomProgram.pulseOnPhase[index] = true;
            gCustomProgram.pulseRemaining[index] = rule.pulseCount;
            gCustomProgram.blinkAt[index] = now;
          }
        }
        if (!gCustomProgram.pulseActive[index]) break;
        if (gCustomProgram.pulseOnPhase[index]) {
          target[rule.relayIndex] = true;
          if (elapsedSince(now, gCustomProgram.blinkAt[index], rule.onMs)) {
            gCustomProgram.pulseOnPhase[index] = false;
            gCustomProgram.blinkAt[index] = now;
          }
        } else {
          target[rule.relayIndex] = false;
          if (elapsedSince(now, gCustomProgram.blinkAt[index], rule.offMs)) {
            if (gCustomProgram.pulseRemaining[index] > 1U) {
              gCustomProgram.pulseRemaining[index]--;
              gCustomProgram.pulseOnPhase[index] = true;
              gCustomProgram.blinkAt[index] = now;
            } else {
              gCustomProgram.pulseRemaining[index] = 0;
              gCustomProgram.pulseActive[index] = false;
            }
          }
        }
        break;
      }

      case CUSTOM_RULE_THERMOSTAT: {
        bool relayOn = false;
        if (rule.sourceIndex < kChannelCount && runtimeData.temperatureValid[rule.sourceIndex]) {
          const bool cooling = rule.thermostatMode == CUSTOM_TH_AUTO ? config().coolingMode : (rule.thermostatMode == CUSTOM_TH_COOL);
          relayOn = thermostatDemandFromSensor(target[rule.relayIndex], cooling, runtimeData.temperature[rule.sourceIndex], rule.setpoint, rule.differential);
        }
        target[rule.relayIndex] = relayOn;
        break;
      }

      case CUSTOM_RULE_ONBOOT: {
        if (gCustomProgram.onbootDone[index]) {
          target[rule.relayIndex] = false;
          break;
        }
        if (!gCustomProgram.onbootActive[index]) {
          if (!elapsedSince(now, runtimeData.bootMillis, rule.offMs)) {
            target[rule.relayIndex] = false;
            break;
          }
          gCustomProgram.onbootActive[index] = true;
          gCustomProgram.blinkAt[index] = now;
        }
        target[rule.relayIndex] = true;
        if (elapsedSince(now, gCustomProgram.blinkAt[index], rule.onMs)) {
          gCustomProgram.onbootActive[index] = false;
          gCustomProgram.onbootDone[index] = true;
          target[rule.relayIndex] = false;
        }
        break;
      }

      default:
        break;
    }
  }
}

void applyCustomMode(uint32_t now) {
  if (!gCustomProgram.valid) {
    if (!gCustomFailSafeApplied) {
      const char* reason = gCustomProgram.error[0] ? gCustomProgram.error : "unknown custom error";
      addLog("Custom failsafe: switching to disabled (%s)", reason);
      mutableConfig().workMode = WORK_DISABLED;
      gCustomFailSafeApplied = true;
    }
    setAllRelaysOff();
    return;
  }

  gCustomFailSafeApplied = false;
  if (!gCustomExecutionPrimed) {
    for (size_t index = 0; index < gCustomProgram.ruleCount; ++index) {
      gCustomProgram.blinkState[index] = false;
      gCustomProgram.blinkAt[index] = now;
      gCustomProgram.edgeArmed[index] = false;
      gCustomProgram.edgeLastInput[index] = false;
      gCustomProgram.pulseActive[index] = false;
      gCustomProgram.pulseOnPhase[index] = false;
      gCustomProgram.pulseRemaining[index] = 0;
      gCustomProgram.onbootActive[index] = false;
      gCustomProgram.onbootDone[index] = false;
    }
    gCustomExecutionPrimed = true;
  }

  bool target[kChannelCount];
  for (size_t index = 0; index < kChannelCount; ++index) {
    target[index] = runtimeData.manualRelayState[index];
  }

  processSequenceProgram(now, target);
  applyLegacyCustomRules(now, target);

  for (size_t index = 0; index < kChannelCount; ++index) {
    runtimeData.manualRelayState[index] = target[index];
    writeRelayHardware(index, target[index]);
  }
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

bool cloudConfigured() {
  return config().enableCloudIot && iotCloudConfigured();
}

unsigned long currentCloudIntervalMs() {
  return iotCloudIntervalMs();
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

    case SENSOR_ANALOG_LINEAR:
      temp = convertAnalogLinear(index, readAnalogAverage(pin));
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

int32_t scaleToSignedInt32(float value, uint8_t scale) {
  const float scaled = value * static_cast<float>(scale);
  long rounded = lroundf(scaled);
  if (rounded > 2147483647L) rounded = 2147483647L;
  if (rounded < -2147483647L - 1L) rounded = -2147483647L - 1L;
  return static_cast<int32_t>(rounded);
}

uint16_t signedInt32Word(int32_t value, bool highWord) {
  const uint32_t raw = static_cast<uint32_t>(value);
  if (highWord) return static_cast<uint16_t>((raw >> 16) & 0xFFFFU);
  return static_cast<uint16_t>(raw & 0xFFFFU);
}

bool modbusWordOrderLowFirst() {
  return config().modbusWordOrder32 == MODBUS_WORD_ORDER_LOW_HIGH;
}

uint16_t signedInt32MappedWord(int32_t value, bool baseAddress) {
  const bool highWord = modbusWordOrderLowFirst() ? !baseAddress : baseAddress;
  return signedInt32Word(value, highWord);
}

uint32_t combineModbusWords(uint16_t firstWord, uint16_t secondWord) {
  if (modbusWordOrderLowFirst()) {
    return (static_cast<uint32_t>(secondWord) << 16) | static_cast<uint32_t>(firstWord);
  }
  return (static_cast<uint32_t>(firstWord) << 16) | static_cast<uint32_t>(secondWord);
}

float scaledSigned16ToFloat(uint16_t raw, float scale) {
  return static_cast<float>(static_cast<int16_t>(raw)) / scale;
}

float scaledSigned32ToFloat(uint32_t raw, float scale) {
  return static_cast<float>(static_cast<int32_t>(raw)) / scale;
}

uint16_t modbusReadValue(uint16_t address) {
  const uint8_t scale = modbusPublishScale();

  // Explicitly mapped base addresses take precedence.
  for (size_t index = 0; index < kChannelCount; ++index) {
    const uint16_t reg = config().modbusTempRegisters[index];
    if (!reg || address != reg) continue;
    if (!runtimeData.temperatureValid[index]) return 0U;
    const int32_t scaled = scaleToSignedInt32(runtimeData.temperature[index], scale);
    if (config().modbusTempRegisterWords[index] > 1U) {
      return signedInt32MappedWord(scaled, true);
    }
    return signedInt32Word(scaled, false);
  }

  for (size_t index = 0; index < kHumidityChannelCount; ++index) {
    const uint16_t reg = config().modbusHumRegisters[index];
    if (!reg || address != reg) continue;
    if (!runtimeData.humidityValid[index]) return 0U;
    const int32_t scaled = scaleToSignedInt32(runtimeData.humidity[index], scale);
    if (config().modbusHumRegisterWords[index] > 1U) {
      return signedInt32MappedWord(scaled, true);
    }
    return signedInt32Word(scaled, false);
  }

  for (size_t index = 0; index < kChannelCount; ++index) {
    if (address == config().modbusRelayRegisters[index]) {
      return runtimeData.relayState[index] ? 1U : 0U;
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

  // Continuation low-word addresses for 32-bit mapped values.
  for (size_t index = 0; index < kChannelCount; ++index) {
    const uint16_t reg = config().modbusTempRegisters[index];
    if (!reg || reg >= 0xFFFFU || config().modbusTempRegisterWords[index] <= 1U) continue;
    if (address != static_cast<uint16_t>(reg + 1U)) continue;
    if (!runtimeData.temperatureValid[index]) return 0U;
    const int32_t scaled = scaleToSignedInt32(runtimeData.temperature[index], scale);
    return signedInt32MappedWord(scaled, false);
  }

  for (size_t index = 0; index < kHumidityChannelCount; ++index) {
    const uint16_t reg = config().modbusHumRegisters[index];
    if (!reg || reg >= 0xFFFFU || config().modbusHumRegisterWords[index] <= 1U) continue;
    if (address != static_cast<uint16_t>(reg + 1U)) continue;
    if (!runtimeData.humidityValid[index]) return 0U;
    const int32_t scaled = scaleToSignedInt32(runtimeData.humidity[index], scale);
    return signedInt32MappedWord(scaled, false);
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
  uint16_t registered[40] = {0U};
  size_t registeredCount = 0U;

  auto alreadyRegistered = [&](uint16_t address) {
    for (size_t index = 0; index < registeredCount; ++index) {
      if (registered[index] == address) return true;
    }
    return false;
  };

  auto rememberAddress = [&](uint16_t address) {
    if (registeredCount < (sizeof(registered) / sizeof(registered[0]))) {
      registered[registeredCount++] = address;
    }
  };

  auto registerReadOnly = [&](uint16_t address) {
    if (!address || alreadyRegistered(address)) return;
    rememberAddress(address);
    bus.addHreg(address, 0U);
    bus.onGetHreg(address, onModbusRead);
  };

  auto registerReadWrite = [&](uint16_t address) {
    if (!address || alreadyRegistered(address)) return;
    rememberAddress(address);
    bus.addHreg(address, 0U);
    bus.onGetHreg(address, onModbusRead);
    bus.onSetHreg(address, onModbusWrite);
  };

  for (size_t index = 0; index < kChannelCount; ++index) {
    const uint16_t tempReg = config().modbusTempRegisters[index];
    if (tempReg) {
      registerReadOnly(tempReg);
      if (config().modbusTempRegisterWords[index] > 1U && tempReg < 0xFFFFU) {
        registerReadOnly(static_cast<uint16_t>(tempReg + 1U));
      }
    }

    const uint16_t relayReg = config().modbusRelayRegisters[index];
    if (relayReg) {
      registerReadWrite(relayReg);
    }
  }

  for (size_t index = 0; index < kHumidityChannelCount; ++index) {
    const uint16_t humReg = config().modbusHumRegisters[index];
    if (!humReg) continue;
    registerReadOnly(humReg);
    if (config().modbusHumRegisterWords[index] > 1U && humReg < 0xFFFFU) {
      registerReadOnly(static_cast<uint16_t>(humReg + 1U));
    }
  }

  if (config().modbusSetpointRegister) {
    registerReadWrite(config().modbusSetpointRegister);
  }

  if (config().modbusStatusRegister) {
    registerReadOnly(config().modbusStatusRegister);
  }
}

#if APP_HAS_MODBUS_RTU
void clearModbusBridgeState() {
  gModbusBridgeClientIp = IPAddress();
  gModbusBridgeTransactionId = 0;
  gModbusBridgeSlaveId = 0;
  gModbusBridgeFunction = 0;
  gModbusBridgePending = false;
  gModbusBridgeReadStartAddress = 0;
  gModbusBridgeReadCount = 0;
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
  if (event == Modbus::EX_SUCCESS || !gModbusBridgePending) return true;

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

void captureBridgeMirrorRequest(uint8_t slaveId, const uint8_t* pdu, uint8_t len) {
  gModbusBridgeReadStartAddress = 0;
  gModbusBridgeReadCount = 0;
  if (!modbusBridgeMirrorCaptureActive() || !pdu || len < 5) return;
  if (slaveId != config().modbusRemoteUnitId) {
    const uint32_t now = millis();
    if (shouldEmitDiagLog(now, gLastBridgeIgnoredUnitLogAt, kModbusDiagIgnoreLogMs)) {
      addLog("Bridge req ignored unit=%u (capture unit=%u)",
             static_cast<unsigned>(slaveId),
             static_cast<unsigned>(config().modbusRemoteUnitId));
    }
    return;
  }
  if (pdu[0] != 0x03 && pdu[0] != 0x04) return;

  const uint16_t startAddress = static_cast<uint16_t>(static_cast<uint16_t>(pdu[1]) << 8) | pdu[2];
  const uint16_t readCount = static_cast<uint16_t>(static_cast<uint16_t>(pdu[3]) << 8) | pdu[4];
  if (!readCount) return;

  gModbusBridgeReadStartAddress = startAddress;
  gModbusBridgeReadCount = readCount;
  const uint32_t now = millis();
  if (shouldEmitDiagLog(now, gLastBridgeReqLogAt, kModbusDiagReqLogMs)) {
    addLog("Bridge req unit=%u fn=0x%02X start=%u count=%u",
           static_cast<unsigned>(slaveId),
           static_cast<unsigned>(pdu[0]),
           static_cast<unsigned>(startAddress),
           static_cast<unsigned>(readCount));
  }
}

void applyBridgeMirrorResponse(uint8_t slaveId, const uint8_t* pdu, uint8_t len) {
  if (!modbusBridgeMirrorCaptureActive() || slaveId != config().modbusRemoteUnitId || !pdu || !len) return;

  const uint8_t function = pdu[0];
  if ((function == 0x03 || function == 0x04) && len >= 4 && gModbusBridgeReadCount) {
    const uint8_t byteCount = pdu[1];
    const uint8_t frameDataBytes = len > 2 ? static_cast<uint8_t>(len - 2U) : 0U;
    const uint8_t usableDataBytes = byteCount < frameDataBytes ? byteCount : frameDataBytes;
    const uint16_t responseRegisterCount = static_cast<uint16_t>(usableDataBytes / 2U);
    const uint16_t registerCount = responseRegisterCount < gModbusBridgeReadCount ? responseRegisterCount : gModbusBridgeReadCount;
    const uint32_t now = millis();
    if (shouldEmitDiagLog(now, gLastBridgeRspLogAt, kModbusDiagRspLogMs)) {
      const uint16_t sample = registerCount
                                ? static_cast<uint16_t>(static_cast<uint16_t>(pdu[2]) << 8 | pdu[3])
                                : 0U;
      addLog("Bridge rsp unit=%u fn=0x%02X start=%u req=%u got=%u sample=0x%04X",
             static_cast<unsigned>(slaveId),
             static_cast<unsigned>(function),
             static_cast<unsigned>(gModbusBridgeReadStartAddress),
             static_cast<unsigned>(gModbusBridgeReadCount),
             static_cast<unsigned>(registerCount),
             static_cast<unsigned>(sample));
    }
    for (uint16_t index = 0; index < registerCount; ++index) {
      const uint8_t offset = static_cast<uint8_t>(2U + (index * 2U));
      const uint16_t value = static_cast<uint16_t>(static_cast<uint16_t>(pdu[offset]) << 8) | pdu[offset + 1U];
      const uint16_t address = static_cast<uint16_t>(gModbusBridgeReadStartAddress + index);
      bool skipSingleApply = false;
      for (size_t channel = 0; channel < kChannelCount; ++channel) {
        if (modbusMirrorTempSourceWordCount(channel) > 1U && address == modbusMirrorTempSourceRegister(channel)) {
          skipSingleApply = true;
          break;
        }
      }
      if (!skipSingleApply) {
        for (size_t channel = 0; channel < kHumidityChannelCount; ++channel) {
          if (modbusMirrorHumSourceWordCount(channel) > 1U && address == modbusMirrorHumSourceRegister(channel)) {
            skipSingleApply = true;
            break;
          }
        }
      }
      if (!skipSingleApply) {
        applyRemoteModbusMirrorValue(address, value, 1U);
      }
    }

    for (size_t channel = 0; channel < kChannelCount; ++channel) {
      if (modbusMirrorTempSourceWordCount(channel) <= 1U) continue;
      const uint16_t startAddress = modbusMirrorTempSourceRegister(channel);
      if (!startAddress) continue;
      if (startAddress < gModbusBridgeReadStartAddress) continue;

      const uint16_t relative = static_cast<uint16_t>(startAddress - gModbusBridgeReadStartAddress);
      if (static_cast<uint32_t>(relative) + 1U >= registerCount) continue;

      const uint8_t highOffset = static_cast<uint8_t>(2U + (relative * 2U));
      const uint8_t lowOffset = static_cast<uint8_t>(highOffset + 2U);
      const uint16_t firstWord = static_cast<uint16_t>(static_cast<uint16_t>(pdu[highOffset]) << 8) | pdu[highOffset + 1U];
      const uint16_t secondWord = static_cast<uint16_t>(static_cast<uint16_t>(pdu[lowOffset]) << 8) | pdu[lowOffset + 1U];
      const uint32_t value = combineModbusWords(firstWord, secondWord);
      applyRemoteModbusMirrorValue(startAddress, value, 2U);
    }

    for (size_t channel = 0; channel < kHumidityChannelCount; ++channel) {
      if (modbusMirrorHumSourceWordCount(channel) <= 1U) continue;
      const uint16_t startAddress = modbusMirrorHumSourceRegister(channel);
      if (!startAddress) continue;
      if (startAddress < gModbusBridgeReadStartAddress) continue;

      const uint16_t relative = static_cast<uint16_t>(startAddress - gModbusBridgeReadStartAddress);
      if (static_cast<uint32_t>(relative) + 1U >= registerCount) continue;

      const uint8_t highOffset = static_cast<uint8_t>(2U + (relative * 2U));
      const uint8_t lowOffset = static_cast<uint8_t>(highOffset + 2U);
      const uint16_t firstWord = static_cast<uint16_t>(static_cast<uint16_t>(pdu[highOffset]) << 8) | pdu[highOffset + 1U];
      const uint16_t secondWord = static_cast<uint16_t>(static_cast<uint16_t>(pdu[lowOffset]) << 8) | pdu[lowOffset + 1U];
      const uint32_t value = combineModbusWords(firstWord, secondWord);
      applyRemoteModbusMirrorValue(startAddress, value, 2U);
    }
    return;
  }

  if (function == 0x06 && len >= 5) {
    const uint16_t address = static_cast<uint16_t>(static_cast<uint16_t>(pdu[1]) << 8) | pdu[2];
    const uint16_t value = static_cast<uint16_t>(static_cast<uint16_t>(pdu[3]) << 8) | pdu[4];
    applyRemoteModbusMirrorValue(address, value, 1U);
  }
}

Modbus::ResultCode onModbusRtuBridgeRaw(uint8_t* data, uint8_t len, void* custom) {
  (void)custom;
  if (!gModbusBridgePending) return Modbus::EX_SUCCESS;
  const uint16_t bridgeTx = gModbusBridgeTransactionId;
  const uint8_t bridgeSlave = gModbusBridgeSlaveId;
  const IPAddress bridgeIp = gModbusBridgeClientIp;

  applyBridgeMirrorResponse(bridgeSlave, data, len);

  modbusIp.setTransactionId(bridgeTx);
  const uint16_t sendResult = modbusIp.rawResponce(bridgeIp, data, len, bridgeSlave);
  if (!sendResult) {
    addLog("Modbus TCP tx fail ip=%s tx=%u unit=%u",
           bridgeIp.toString().c_str(),
           static_cast<unsigned>(bridgeTx),
           static_cast<unsigned>(bridgeSlave));
    setModbusStatus("bridge tcp reply failed");
  } else {
    setModbusStatus(String("bridge ok slave ") + String(bridgeSlave));
  }
  clearModbusBridgeState();
  return Modbus::EX_SUCCESS;
}

Modbus::ResultCode onModbusTcpBridgeRaw(uint8_t* data, uint8_t len, void* custom) {
  auto* frame = static_cast<Modbus::frame_arg_t*>(custom);
  if (!frame || !len) return Modbus::EX_ILLEGAL_FUNCTION;

  // Keep a local UnitID for on-device register map in TCP<->RTU mode.
  // Any other UnitID is forwarded to RTU slaves.
  if (frame->unitId == config().modbusUnitId) {
    return Modbus::EX_PASSTHROUGH;
  }

  if (!frame->unitId) {
    modbusIp.setTransactionId(frame->transactionId);
    modbusIp.errorResponce(IPAddress(frame->ipaddr), static_cast<Modbus::FunctionCode>(data[0]), Modbus::EX_ILLEGAL_FUNCTION, frame->unitId);
    addLog("Modbus TCP reject unit 0 tx=%u", static_cast<unsigned>(frame->transactionId));
    return Modbus::EX_ILLEGAL_FUNCTION;
  }

  gLastBridgeTrafficAt = millis();

  if (gModbusBridgePending) {
    modbusIp.setTransactionId(frame->transactionId);
    modbusIp.errorResponce(IPAddress(frame->ipaddr), static_cast<Modbus::FunctionCode>(data[0]), Modbus::EX_SLAVE_DEVICE_BUSY, frame->unitId);
    addLog("Modbus bridge busy: new req unit %u while waiting unit %u",
           static_cast<unsigned>(frame->unitId),
           static_cast<unsigned>(gModbusBridgeSlaveId));
    return Modbus::EX_SLAVE_DEVICE_BUSY;
  }

  if (modbusRtu.slave()) {
    modbusIp.setTransactionId(frame->transactionId);
    modbusIp.errorResponce(IPAddress(frame->ipaddr), static_cast<Modbus::FunctionCode>(data[0]), Modbus::EX_SLAVE_DEVICE_BUSY, frame->unitId);
    addLog("Modbus bridge busy: rtu transaction active (unit %u)", static_cast<unsigned>(frame->unitId));
    return Modbus::EX_SLAVE_DEVICE_BUSY;
  }

  gModbusBridgeClientIp = IPAddress(frame->ipaddr);
  gModbusBridgeTransactionId = frame->transactionId;
  gModbusBridgeSlaveId = frame->unitId;
  gModbusBridgeFunction = data[0];
  gModbusBridgePending = true;
  captureBridgeMirrorRequest(gModbusBridgeSlaveId, data, len);
  setModbusStatus(String("bridge req slave ") + String(gModbusBridgeSlaveId));

  if (!modbusRtu.rawRequest(gModbusBridgeSlaveId, data, len, onModbusRtuBridgeTransaction)) {
    modbusIp.setTransactionId(gModbusBridgeTransactionId);
    modbusIp.errorResponce(gModbusBridgeClientIp,
                           static_cast<Modbus::FunctionCode>(gModbusBridgeFunction),
                           Modbus::EX_SLAVE_FAILURE,
                           gModbusBridgeSlaveId);
    setModbusStatus("bridge dispatch failed");
    addLog("Modbus bridge dispatch fail: unit %u fn 0x%02X",
           static_cast<unsigned>(gModbusBridgeSlaveId),
           static_cast<unsigned>(gModbusBridgeFunction));
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

bool dispatchRemoteReadRequest(uint16_t address, uint8_t requestCount, uint16_t* values, bool useInputRegisters) {
  if (!values) return false;
  values[0] = 0;
  values[1] = 0;

  gModbusLastRtuEvent = Modbus::EX_TIMEOUT;
  const uint16_t transaction = useInputRegisters
                                 ? modbusRtu.readIreg(config().modbusRemoteUnitId, address, values, requestCount, onModbusMirrorTransaction)
                                 : modbusRtu.readHreg(config().modbusRemoteUnitId, address, values, requestCount, onModbusMirrorTransaction);
  if (!transaction) {
    gModbusLastRtuEvent = Modbus::EX_GENERAL_FAILURE;
    return false;
  }

  const uint32_t timeoutMs = config().modbusTaskMs < 250U ? 500U : static_cast<uint32_t>(config().modbusTaskMs) * 2U;
  const uint32_t startedAt = millis();
  while (modbusRtu.slave() && (millis() - startedAt) < timeoutMs) {
    if (config().modbusMode == MODBUS_TCP_TO_RTU || config().modbusMode == MODBUS_SLAVE_TO_ME_HYBRID_TCP) {
      modbusIp.task();
    }
    modbusRtu.task();
    yield();
  }

  if (modbusRtu.slave()) {
    return false;
  }

  return gModbusLastRtuEvent == Modbus::EX_SUCCESS;
}

bool readRemoteHoldingRegisters(uint16_t address, uint8_t count, uint16_t* values) {
  if (!values) return false;
  values[0] = 0;
  values[1] = 0;
  if (!address || !count) return true;
  if (modbusRtu.slave()) return false;

  const uint8_t requestCount = count > 1U ? 2U : 1U;
  if (requestCount > 1U) {
    // Two-word telemetry often lives in FC4, but some devices only expose it in FC3.
    const bool fc4Ok = dispatchRemoteReadRequest(address, requestCount, values, true);
    if (fc4Ok) return true;

    const Modbus::ResultCode fc4Code = gModbusLastRtuEvent;
    const bool fc3Ok = dispatchRemoteReadRequest(address, requestCount, values, false);
    if (!fc3Ok) {
      const uint32_t now = millis();
      if (shouldEmitDiagLog(now, gLastRemoteReadDiagLogAt, kModbusDiagReadLogMs)) {
        addLog("Mirror 32b read fail reg=%u FC4=0x%02X FC3=0x%02X",
               static_cast<unsigned>(address),
               static_cast<unsigned>(fc4Code),
               static_cast<unsigned>(gModbusLastRtuEvent));
      }
      return false;
    }

    const uint32_t now = millis();
    if (shouldEmitDiagLog(now, gLastRemoteReadDiagLogAt, kModbusDiagReadLogMs)) {
      addLog("Mirror 32b fallback FC3 reg=%u after FC4=0x%02X",
             static_cast<unsigned>(address),
             static_cast<unsigned>(fc4Code));
    }
    return true;
  }
  if (dispatchRemoteReadRequest(address, requestCount, values, false)) return true;
  if (dispatchRemoteReadRequest(address, requestCount, values, true)) return true;
  return false;
}

bool readRemoteHoldingValue(uint16_t address, uint8_t count, uint32_t& value) {
  value = 0;
  const uint8_t requestCount = count > 1U ? 2U : 1U;
  uint16_t words[2] = {0U, 0U};
  if (!readRemoteHoldingRegisters(address, requestCount, words)) {
    return false;
  }

  if (requestCount == 1U) {
    value = words[0];
  } else {
    value = combineModbusWords(words[0], words[1]);
  }
  return true;
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
    if (config().modbusMode == MODBUS_TCP_TO_RTU || config().modbusMode == MODBUS_SLAVE_TO_ME_HYBRID_TCP) {
      modbusIp.task();
    }
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

bool addressRequiresTwoWordMirrorValue(uint16_t address) {
  for (size_t index = 0; index < kChannelCount; ++index) {
    if (modbusMirrorTempSourceWordCount(index) > 1U && address == modbusMirrorTempSourceRegister(index)) {
      return true;
    }
  }
  for (size_t index = 0; index < kHumidityChannelCount; ++index) {
    if (modbusMirrorHumSourceWordCount(index) > 1U && address == modbusMirrorHumSourceRegister(index)) {
      return true;
    }
  }
  return false;
}

void applyRemoteModbusMirrorValue(uint16_t address, uint32_t value, uint8_t sourceWords) {
  if (sourceWords < 2U && addressRequiresTwoWordMirrorValue(address)) {
    const uint32_t now = millis();
    if (shouldEmitDiagLog(now, gLastMirrorDecodeLogAt, kModbusDiagDecodeLogMs)) {
      addLog("Mirror drop single-word addr=%u raw=0x%04X (requires 32b)",
             static_cast<unsigned>(address),
             static_cast<unsigned>(value & 0xFFFFU));
    }
    return;
  }
  const float scale = static_cast<float>(modbusMirrorScale());
  const bool lowFirst = modbusWordOrderLowFirst();
  const uint32_t now = millis();

  for (size_t index = 0; index < kChannelCount; ++index) {
    if (address == modbusMirrorTempSourceRegister(index)) {
      float decoded = NAN;
      if (sourceWords > 1U || modbusMirrorTempSourceWordCount(index) > 1U) {
        decoded = scaledSigned32ToFloat(value, scale);
      } else {
        decoded = scaledSigned16ToFloat(static_cast<uint16_t>(value & 0xFFFFU), scale);
      }
      runtimeData.temperature[index] = decoded;
      runtimeData.temperatureValid[index] = true;
      if ((address != gLastMirrorDecodeAddress || value != gLastMirrorDecodeRaw || sourceWords != gLastMirrorDecodeWords) &&
          shouldEmitDiagLog(now, gLastMirrorDecodeLogAt, kModbusDiagDecodeLogMs)) {
        addLog("Mirror temp%u addr=%u words=%u order=%s raw=0x%08lX -> %.3f",
               static_cast<unsigned>(index + 1U),
               static_cast<unsigned>(address),
               static_cast<unsigned>(sourceWords),
               lowFirst ? "LH" : "HL",
               static_cast<unsigned long>(value),
               decoded);
        gLastMirrorDecodeAddress = address;
        gLastMirrorDecodeRaw = value;
        gLastMirrorDecodeWords = sourceWords;
      }
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
      float decoded = NAN;
      if (sourceWords > 1U || modbusMirrorHumSourceWordCount(index) > 1U) {
        decoded = scaledSigned32ToFloat(value, scale);
      } else {
        decoded = scaledSigned16ToFloat(static_cast<uint16_t>(value & 0xFFFFU), scale);
      }
      runtimeData.humidity[index] = decoded;
      runtimeData.humidityValid[index] = true;
      if ((address != gLastMirrorDecodeAddress || value != gLastMirrorDecodeRaw || sourceWords != gLastMirrorDecodeWords) &&
          shouldEmitDiagLog(now, gLastMirrorDecodeLogAt, kModbusDiagDecodeLogMs)) {
        addLog("Mirror hum%u addr=%u words=%u order=%s raw=0x%08lX -> %.3f",
               static_cast<unsigned>(index + 1U),
               static_cast<unsigned>(address),
               static_cast<unsigned>(sourceWords),
               lowFirst ? "LH" : "HL",
               static_cast<unsigned long>(value),
               decoded);
        gLastMirrorDecodeAddress = address;
        gLastMirrorDecodeRaw = value;
        gLastMirrorDecodeWords = sourceWords;
      }
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
    const uint16_t status = static_cast<uint16_t>(value & 0xFFFFU);
    runtimeData.defrosting = (status & 0x0002U) != 0;
    runtimeData.highAlarmActive = (status & 0x0004U) != 0;
    runtimeData.lowAlarmActive = (status & 0x0008U) != 0;
  }
}

bool pollRemoteModbusMirror() {
  const bool includeControlRegisters = modbusMirrorReadbackActive();
  const uint16_t setpointAddress = includeControlRegisters ? modbusMirrorSetpointSourceRegister() : 0U;
  const uint16_t statusAddress = includeControlRegisters ? modbusMirrorStatusSourceRegister() : 0U;

  if (includeControlRegisters && !statusAddress) {
    runtimeData.defrosting = false;
    runtimeData.highAlarmActive = false;
    runtimeData.lowAlarmActive = false;
  }

  struct MirrorPollTarget {
    uint16_t address;
    uint8_t words;
  };

  const MirrorPollTarget targets[] = {
    {modbusMirrorTempSourceRegister(0), modbusMirrorTempSourceWordCount(0)},
    {modbusMirrorTempSourceRegister(1), modbusMirrorTempSourceWordCount(1)},
    {modbusMirrorTempSourceRegister(2), modbusMirrorTempSourceWordCount(2)},
    {modbusMirrorTempSourceRegister(3), modbusMirrorTempSourceWordCount(3)},
    {modbusMirrorHumSourceRegister(0), modbusMirrorHumSourceWordCount(0)},
    {modbusMirrorHumSourceRegister(1), modbusMirrorHumSourceWordCount(1)},
    {modbusMirrorRelaySourceRegister(0), 1U},
    {modbusMirrorRelaySourceRegister(1), 1U},
    {modbusMirrorRelaySourceRegister(2), 1U},
    {modbusMirrorRelaySourceRegister(3), 1U},
    {setpointAddress, 1U},
    {statusAddress, 1U},
  };

  bool ok = true;
  uint16_t firstFailedAddress = 0;
  Modbus::ResultCode firstFailedCode = Modbus::EX_SUCCESS;
  uint8_t failedCount = 0;
  for (const MirrorPollTarget& target : targets) {
    if (!target.address) continue;
    uint32_t value = 0;
    if (!readRemoteHoldingValue(target.address, target.words, value)) {
      if (!firstFailedAddress) {
        firstFailedAddress = target.address;
        firstFailedCode = gModbusLastRtuEvent;
      }
      if (failedCount < 255U) failedCount++;
      ok = false;
      continue;
    }
    applyRemoteModbusMirrorValue(target.address, value, target.words);
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

  gLastBridgeMirrorPollAt = 0;
  gLastBridgeTrafficAt = 0;

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
      setModbusStatus(String("bridge tcp ") + String(config().modbusPort) +
                      String(" local unit ") + String(config().modbusUnitId));
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

  if (!modbusMirrorReadbackActive()) {
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
      gCustomExecutionPrimed = false;
      applyThermostatMode(now);
      break;
    case WORK_PUSHBUTTON:
      gCustomExecutionPrimed = false;
      gHighAlarmConditionAt = 0;
      gLowAlarmConditionAt = 0;
      applyPushbuttonMode();
      break;
    case WORK_MANUAL:
      gCustomExecutionPrimed = false;
      gHighAlarmConditionAt = 0;
      gLowAlarmConditionAt = 0;
      applyManualMode();
      break;
    case WORK_CUSTOM:
      gHighAlarmConditionAt = 0;
      gLowAlarmConditionAt = 0;
      runtimeData.defrosting = false;
      applyCustomMode(now);
      break;
    default:
      gCustomExecutionPrimed = false;
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
  if (config().modbusMode == MODBUS_TCP_TO_RTU && config().modbusRemoteUnitId != 0) {
    for (size_t index = 0; index < kChannelCount; ++index) {
      if (!modbusMirrorTempSourceRegister(index)) {
        addLog("Mirror temp%u source=internal (reg=0)", static_cast<unsigned>(index + 1U));
      }
    }
    for (size_t index = 0; index < kHumidityChannelCount; ++index) {
      if (!modbusMirrorHumSourceRegister(index)) {
        addLog("Mirror hum%u source=internal (reg=0)", static_cast<unsigned>(index + 1U));
      }
    }
  }
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
      // In TCP->RTU bridge mode we keep passive capture-only behavior to avoid
      // RTU collisions with external masters polling through the bridge.
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

bool customProgramValidFlag() {
  return gCustomProgram.valid;
}

uint16_t customProgramCompiledCount() {
  return static_cast<uint16_t>(gCustomProgram.ruleCount + gCustomProgram.sequenceStepCount);
}

const char* customProgramErrorText() {
  return gCustomProgram.error;
}

const char* customProgramModeText() {
  return customProgramModeLabel(gCustomProgram.mode);
}

bool sequenceProgramValidFlag() {
  return gCustomProgram.sequence.valid;
}

bool sequenceProgramRunningFlag() {
  return gCustomProgram.sequence.running;
}

const char* sequenceProgramNameText() {
  return gCustomProgram.sequence.name;
}

const char* sequenceProgramStateText() {
  return sequenceStateLabel(gCustomProgram.sequence.state);
}

uint8_t sequenceProgramCurrentStep() {
  if (!gCustomProgram.sequence.running) return 0U;
  return static_cast<uint8_t>(gCustomProgram.sequence.currentStep + 1U);
}

uint8_t sequenceProgramCurrentLoop() {
  return gCustomProgram.sequence.currentLoop;
}

const char* sequenceProgramErrorText() {
  return gCustomProgram.sequence.errorMessage;
}

size_t sequenceProgramErrorLine() {
  return gCustomProgram.sequence.errorLine;
}

uint8_t sequenceProgramUsedRelayMask() {
  return gCustomProgram.sequence.usedRelayMask;
}

uint8_t sequenceProgramReservedRelayMask() {
  return gCustomProgram.sequence.running ? gCustomProgram.sequence.reservedRelayMask : 0U;
}

float sequenceProgramLastTemperature() {
  return gCustomProgram.sequence.lastTemperature;
}

bool setVirtualInputByLabel(const String& label, bool state) {
  const int index = virtualInputIndexFromLabel(label);
  if (index < 0) return false;
  setVirtualInputStateByIndex(static_cast<uint8_t>(index), state);
  return true;
}

bool pulseVirtualInputByLabel(const String& label) {
  const int index = virtualInputIndexFromLabel(label);
  if (index < 0) return false;
  pulseVirtualInputByIndex(static_cast<uint8_t>(index));
  return true;
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
  recompileCustomProgramFromConfig();
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
#if defined(ARDUINO_ARCH_ESP32)
  WiFi.disconnect(true, true);
#else
  WiFi.disconnect(true);
#endif
  resetConfigToDefaults(configDriver.data);
  applyCommissioningSafeDefaults(configDriver.data);
  sanitizeConfig(configDriver.data);
  recompileCustomProgramFromConfig();
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
  StaticJsonDocument<4864> doc;
  doc["platform"] = appPlatformName();
  doc["mode"] = workModeLabel(config().workMode);
  doc["customProgramValid"] = gCustomProgram.valid;
  doc["customProgramRuleCount"] = static_cast<uint16_t>(gCustomProgram.ruleCount + gCustomProgram.sequenceStepCount);
  doc["customProgramError"] = gCustomProgram.error;
  doc["customProgramMode"] = customProgramModeLabel(gCustomProgram.mode);
  doc["sequenceValid"] = gCustomProgram.sequence.valid;
  doc["sequenceRunning"] = gCustomProgram.sequence.running;
  doc["sequenceName"] = gCustomProgram.sequence.name;
  doc["sequenceState"] = sequenceStateLabel(gCustomProgram.sequence.state);
  doc["sequenceCurrentStep"] = gCustomProgram.sequence.running ?
                               static_cast<uint16_t>(gCustomProgram.sequence.currentStep + 1U) :
                               static_cast<uint16_t>(0U);
  doc["sequenceCurrentLoop"] = gCustomProgram.sequence.currentLoop;
  if (gCustomProgram.sequence.errorMessage[0]) doc["sequenceError"] = gCustomProgram.sequence.errorMessage;
  else doc["sequenceError"] = nullptr;
  if (gCustomProgram.sequence.errorLine) doc["sequenceErrorLine"] = gCustomProgram.sequence.errorLine;
  else doc["sequenceErrorLine"] = nullptr;
  if (!isnan(gCustomProgram.sequence.lastTemperature)) doc["sequenceLastTemp"] = gCustomProgram.sequence.lastTemperature;
  else doc["sequenceLastTemp"] = nullptr;
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
  JsonObject virtualInputs = doc.createNestedObject("virtualInputs");
  JsonArray usedRelays = doc.createNestedArray("sequenceUsedRelays");
  JsonArray reservedRelays = doc.createNestedArray("sequenceReservedRelays");

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
    virtualInputs[String("VIN") + String(index + 1U)] = runtimeData.virtualInputState[index];
    if ((gCustomProgram.sequence.usedRelayMask & static_cast<uint8_t>(1U << index)) != 0U) {
      usedRelays.add(String("REL") + String(index + 1U));
    }
    if ((gCustomProgram.sequence.reservedRelayMask & static_cast<uint8_t>(1U << index)) != 0U &&
        gCustomProgram.sequence.running) {
      reservedRelays.add(String("REL") + String(index + 1U));
    }
  }

  String out;
  serializeJson(doc, out);
  return out;
}

String buildConfigJson() {
  DynamicJsonDocument doc(kConfigJsonCapacity);
  serializeConfig(doc.to<JsonObject>(), config());
  doc.remove("iotDeviceSecret");
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
  DynamicJsonDocument doc(2048);
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
  if (root.containsKey("customProgram")) {
    copyText(mutableConfig().customProgram, root["customProgram"] | String(mutableConfig().customProgram));
    configChanged = true;
  }
  if (root.containsKey("pulseVirtualInput") && !root["pulseVirtualInput"].isNull()) {
    const String label = root["pulseVirtualInput"].as<String>();
    if (!pulseVirtualInputByLabel(label)) {
      errorMessage = "pulseVirtualInput invalido (usa VIN1..VIN4)";
      return false;
    }
  }

  JsonObjectConst virtualInputs = root["virtualInputs"].as<JsonObjectConst>();
  if (!virtualInputs.isNull()) {
    for (JsonPairConst pair : virtualInputs) {
      const int index = virtualInputIndexFromLabel(String(pair.key().c_str()));
      if (index < 0) {
        errorMessage = "virtualInputs invalido (usa VIN1..VIN4)";
        return false;
      }
      setVirtualInputStateByIndex(static_cast<uint8_t>(index), pair.value().as<bool>());
    }
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
  recompileCustomProgramFromConfig();
  if (gCustomProgram.sequence.present && gCustomProgram.sequence.valid) {
    gCustomProgram.sequence.running = false;
    gCustomProgram.sequence.state = SEQ_STATE_ABORTED_AFTER_REBOOT;
  }
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
  initializeFactoryResetButton();
  gOperationalRuntimeArmed = gHasStoredConfig;
  addLog("Boot step: modbus init");
  setupModbusRuntime();

  addLog("Boot step: edge attach");
  Edge.attach(configDriver);
  Edge.attach(systemDriver, kSystemDriverMs);
  Edge.attach(sensorDriver, kSensorDriverMs);
  Edge.attach(controlDriver, config().controlPeriodMs);
  Edge.attach(cloudDriver, currentCloudIntervalMs());
  Edge.attach(modbusDriver, config().modbusTaskMs);

  addLog("LH Industrial V6 initialized");
  addLog("Provisioning URI: /setup");
  addLog("AP password: %s", config().apPassword[0] ? config().apPassword : "12345678");
  addLog("Auth user: %s", config().adminUser);
}

void processApplication() {
  const uint32_t now = millis();
  processFactoryResetButton(now);
  if (gDnsStarted) gDnsServer.processNextRequest();
  if (gServerStarted) server.handleClient();
  if (gOtaStarted) ArduinoOTA.handle();
  processVirtualInputPulses(millis());
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
