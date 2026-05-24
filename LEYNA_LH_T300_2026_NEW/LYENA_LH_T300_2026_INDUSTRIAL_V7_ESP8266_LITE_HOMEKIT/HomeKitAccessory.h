#pragma once

#if defined(ARDUINO_ARCH_ESP8266)
#include <homekit/homekit.h>

#ifdef __cplusplus
extern "C" {
#endif

extern homekit_characteristic_t lyena_cha_current_temperature;
extern homekit_characteristic_t lyena_cha_current_relative_humidity;
extern homekit_server_config_t lyena_homekit_config;
void lyena_homekit_set_identity(const char* accessoryName,
                                const char* serialNumber,
                                const char* model,
                                const char* firmwareRevision);

#ifdef __cplusplus
}
#endif

#endif
