#include "HomeKitBridge.h"

#include <Arduino.h>
#include <math.h>
#include <stdio.h>

#include "BoardCompat.h"

#if APP_ENABLE_HOMEKIT && defined(ARDUINO_ARCH_ESP8266)
#define APP_HAS_NATIVE_HOMEKIT 1
extern "C" {
#include <arduino_homekit_server.h>
#include <homekit/homekit.h>
int homekit_storage_reset();
}
#include "HomeKitAccessory.h"
#endif

#ifndef APP_HAS_NATIVE_HOMEKIT
#define APP_HAS_NATIVE_HOMEKIT 0
#endif

#ifdef NO_INLINE
#undef NO_INLINE
#endif
#include "AppConfig.h"

namespace industrial_v2 {

#if APP_HAS_NATIVE_HOMEKIT
namespace {

static constexpr uint32_t kNotifyMinMs = 2500U;
static constexpr uint32_t kHomeKitRetryMs = 15000U;
static constexpr uint32_t kHomeKitMinHeapStart = 14000U;
static constexpr uint32_t kHomeKitMinHeapLoop = 3000U;
static constexpr uint32_t kHomeKitForceStartAfterMs = 15000U;
static constexpr uint32_t kHomeKitForceStartMinHeap = 10000U;
static constexpr bool kForceHomekitStorageResetOnBoot = false;
static constexpr const char* kHomekitStorageResetMarkerFile = "/hk_hap_reset_once_v1";

bool gHomekitStarted = false;
uint32_t gLastNotifyAt = 0;
uint32_t gLastInitAttemptAt = 0;
uint32_t gWifiReadyAt = 0;
const char* gHomekitStatus = "idle";
float gLastTemp = NAN;
float gLastHumidity = NAN;
bool gIdentityPrepared = false;
bool gStorageResetHandled = false;

inline bool changedEnough(float current, float previous, float delta) {
  if (isnan(previous)) return true;
  return fabsf(current - previous) >= delta;
}

void prepareIdentity(const AppConfigData& config) {
  if (gIdentityPrepared) return;

  char name[32];
  char serial[16];
  char model[24];
  char firmware[16];

  const char* hostName = config.hostName[0] ? config.hostName : "LYENA";
  snprintf(name, sizeof(name), "%s-HK", hostName);
  snprintf(serial, sizeof(serial), "SN%06lX", static_cast<unsigned long>(appChipId() & 0xFFFFFFUL));
  snprintf(model, sizeof(model), "LH-T300-V7-LITE");
  snprintf(firmware, sizeof(firmware), "2026.04");

  lyena_homekit_set_identity(name, serial, model, firmware);
  gIdentityPrepared = true;
}

}  // namespace
#endif

void homekitBridgeBegin(const AppConfigData& config) {
#if APP_HAS_NATIVE_HOMEKIT
  if (gHomekitStarted) return;

  if (!config.wifiSsid[0]) {
    gHomekitStatus = "waiting-config";
    gWifiReadyAt = 0;
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    gHomekitStatus = "waiting-wifi";
    gWifiReadyAt = 0;
    return;
  }

  const uint32_t now = millis();
  if (!gWifiReadyAt) gWifiReadyAt = now;

  const uint32_t freeHeap = appFreeHeap();
  const bool forceStart = static_cast<uint32_t>(now - gWifiReadyAt) >= kHomeKitForceStartAfterMs &&
                          freeHeap >= kHomeKitForceStartMinHeap;
  if (freeHeap < kHomeKitMinHeapStart && !forceStart) {
    gHomekitStatus = "waiting-heap";
    return;
  }

  prepareIdentity(config);

  if (gLastInitAttemptAt && static_cast<uint32_t>(now - gLastInitAttemptAt) < kHomeKitRetryMs) {
    return;
  }
  gLastInitAttemptAt = now;

  if (!gStorageResetHandled) {
    bool shouldResetStorage = kForceHomekitStorageResetOnBoot;
    if (!shouldResetStorage && !APP_FILESYSTEM.exists(kHomekitStorageResetMarkerFile)) {
      shouldResetStorage = true;
    }

    if (shouldResetStorage) {
      homekit_storage_reset();
      Serial.println("HomeKit: forced one-time storage reset for clean discovery");
    }

    File markerFile = APP_FILESYSTEM.open(kHomekitStorageResetMarkerFile, "w");
    if (markerFile) {
      markerFile.print("done");
      markerFile.close();
    }
    gStorageResetHandled = true;
  }

  arduino_homekit_setup(&lyena_homekit_config);
  char setupUri[32];
  if (homekit_get_setup_uri(&lyena_homekit_config, setupUri, sizeof(setupUri)) == 0) {
    Serial.printf("HomeKit setup URI: %s\r\n", setupUri);
  }
  gHomekitStarted = true;
  gHomekitStatus = forceStart ? "starting-low-heap" : "starting";
#else
  (void)config;
#endif
}

void homekitBridgeProcess(const AppRuntimeData& runtime) {
#if APP_HAS_NATIVE_HOMEKIT
  if (!gHomekitStarted) return;
  if (!runtime.wifiConnected) {
    gHomekitStatus = "waiting-wifi";
    return;
  }
  const uint32_t freeHeap = appFreeHeap();
  if (freeHeap < kHomeKitMinHeapLoop) gHomekitStatus = "low-heap";
  else gHomekitStatus = "running";
  arduino_homekit_loop();

  const uint32_t now = millis();
  if ((now - gLastNotifyAt) < kNotifyMinMs) return;
  gLastNotifyAt = now;

  if (runtime.temperatureValid[0]) {
    float t = runtime.temperature[0];
    if (t < 0.0f) t = 0.0f;
    if (t > 100.0f) t = 100.0f;
    if (changedEnough(t, gLastTemp, 0.1f)) {
      gLastTemp = t;
      lyena_cha_current_temperature.value.float_value = t;
      homekit_characteristic_notify(&lyena_cha_current_temperature, lyena_cha_current_temperature.value);
    }
  }

  if (runtime.humidityValid[0]) {
    float h = runtime.humidity[0];
    if (h < 0.0f) h = 0.0f;
    if (h > 100.0f) h = 100.0f;
    if (changedEnough(h, gLastHumidity, 1.0f)) {
      gLastHumidity = h;
      lyena_cha_current_relative_humidity.value.float_value = h;
      homekit_characteristic_notify(&lyena_cha_current_relative_humidity,
                                    lyena_cha_current_relative_humidity.value);
    }
  }
#else
  (void)runtime;
#endif
}

void homekitBridgeResetPairings() {
#if APP_HAS_NATIVE_HOMEKIT
  homekit_storage_reset();
  gHomekitStarted = false;
  gLastInitAttemptAt = 0;
  gWifiReadyAt = 0;
  gLastTemp = NAN;
  gLastHumidity = NAN;
  gIdentityPrepared = false;
  gHomekitStatus = "idle";
#endif
}

const char* homekitBridgeStatus() {
#if APP_HAS_NATIVE_HOMEKIT
  return gHomekitStatus;
#elif APP_ENABLE_HOMEKIT
  return "library-missing";
#else
  return "disabled";
#endif
}

}  // namespace industrial_v2
