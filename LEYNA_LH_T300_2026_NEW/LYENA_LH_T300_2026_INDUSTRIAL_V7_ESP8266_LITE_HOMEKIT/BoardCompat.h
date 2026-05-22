#pragma once

#include <Arduino.h>

#define APP_ENABLE_MODBUS 0

#if defined(ARDUINO_ARCH_ESP8266)
#include <ESP8266HTTPClient.h>
#include <ESP8266WebServer.h>
#include <ESP8266WiFi.h>
#include <ESP8266mDNS.h>
#include <LittleFS.h>
using AppWebServer = ESP8266WebServer;
#define APP_FILESYSTEM LittleFS
#define APP_HAS_INTERNAL_TEMP 0
#define APP_HAS_MIN_HEAP 0
#define APP_HAS_MODBUS_RTU 0
#define APP_ENABLE_HOMEKIT 1
#define APP_ENABLE_MAINT_CLOUD 0
#define APP_ENABLE_WEBUI 0

inline const char* appPlatformName() { return "ESP8266"; }
inline bool appBeginFilesystem() { return LittleFS.begin(); }
inline void appUpdateMdns() { MDNS.update(); }
inline uint32_t appFreeHeap() { return ESP.getFreeHeap(); }
inline uint32_t appMinHeap() { return ESP.getFreeHeap(); }
inline uint16_t appAnalogMax() { return 1023U; }
inline String appResetReasonText() { return ESP.getResetReason(); }
inline void appSetHostName(const char* hostName) { WiFi.hostname(hostName); }

#elif defined(ARDUINO_ARCH_ESP32)
#include <HTTPClient.h>
#include <SPIFFS.h>
#include <WebServer.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <esp_system.h>
using AppWebServer = WebServer;
#define APP_FILESYSTEM SPIFFS
#define APP_HAS_INTERNAL_TEMP 1
#define APP_HAS_MIN_HEAP 1
#define APP_HAS_MODBUS_RTU 1
#define APP_ENABLE_HOMEKIT 0
#define APP_ENABLE_MAINT_CLOUD 1
#define APP_ENABLE_WEBUI 1

inline const char* appPlatformName() { return "ESP32"; }
inline bool appBeginFilesystem() { return SPIFFS.begin(true); }
inline void appUpdateMdns() {}
inline uint32_t appFreeHeap() { return ESP.getFreeHeap(); }
inline uint32_t appMinHeap() { return esp_get_minimum_free_heap_size(); }
inline uint16_t appAnalogMax() { return 4095U; }
inline void appSetHostName(const char* hostName) { WiFi.setHostname(hostName); }
inline String appResetReasonText() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "POWERON";
    case ESP_RST_EXT: return "EXT";
    case ESP_RST_SW: return "SW";
    case ESP_RST_PANIC: return "PANIC";
    case ESP_RST_INT_WDT: return "INT_WDT";
    case ESP_RST_TASK_WDT: return "TASK_WDT";
    case ESP_RST_WDT: return "WDT";
    case ESP_RST_DEEPSLEEP: return "DEEPSLEEP";
    case ESP_RST_BROWNOUT: return "BROWNOUT";
    case ESP_RST_SDIO: return "SDIO";
    default: return "UNKNOWN";
  }
}

#else
#error Unsupported target platform
#endif

inline uint32_t appChipId() {
#if defined(ARDUINO_ARCH_ESP8266)
  return ESP.getChipId();
#else
  return static_cast<uint32_t>(ESP.getEfuseMac() >> 24);
#endif
}
