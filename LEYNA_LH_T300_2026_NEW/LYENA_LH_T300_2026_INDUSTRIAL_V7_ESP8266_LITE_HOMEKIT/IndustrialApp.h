#pragma once

#include <Arduino.h>
#include <EdgeLite.h>

#include "BoardCompat.h"

#if APP_ENABLE_HOMEKIT && defined(ARDUINO_ARCH_ESP8266)
#include <arduino_homekit_server.h>
#endif

#if APP_ENABLE_MODBUS
#include <ModbusIP_ESP8266.h>
#endif

#include "AppConfig.h"

namespace industrial_v2 {

extern AppWebServer server;
extern AppRuntimeData runtimeData;

void initializeApplication();
void processApplication();
void recordLoopDuration(uint32_t loopDurationUs);

AppConfigData& mutableConfig();
const AppConfigData& config();
bool hasStoredConfig();

String buildStateJson();
String buildConfigJson();
String buildLogsText();

bool updateConfigFromJson(const String& body, String& errorMessage);
bool handleControlJson(const String& body, String& errorMessage);
bool updateNetworkFromJson(const String& body, String& errorMessage);
bool ensureAdminAuthenticated();

bool saveConfigToFile();
void scheduleRestart(const char* reason, uint32_t delayMs = 1500U);
void factoryResetAndRestart();
void addLog(const char* format, ...);

}  // namespace industrial_v2
