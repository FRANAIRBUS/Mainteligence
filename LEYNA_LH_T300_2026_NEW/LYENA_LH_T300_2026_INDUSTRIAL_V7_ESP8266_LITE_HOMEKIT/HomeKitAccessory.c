#if defined(ARDUINO_ARCH_ESP8266)

#include <homekit/homekit.h>
#include <homekit/characteristics.h>
#include <stddef.h>
#include <string.h>

void lyena_accessory_identify(homekit_value_t value) {
  (void)value;
}

static char gLyenaName[32] = "LYENA Sensor";
static char gLyenaSerial[16] = "SN000000";
static char gLyenaModel[24] = "LH-T300-V7-LITE";
static char gLyenaFirmware[16] = "2026.04";
static char gLyenaSetupId[5] = "LHV7";

static void copyText(char* dst, size_t length, const char* src) {
    if (!dst || !length) return;
    if (!src) {
        dst[0] = '\0';
        return;
    }
    strncpy(dst, src, length - 1U);
    dst[length - 1U] = '\0';
}

void lyena_homekit_set_identity(const char* accessoryName,
                                                                const char* serialNumber,
                                                                const char* model,
                                                                const char* firmwareRevision) {
    copyText(gLyenaName, sizeof(gLyenaName), accessoryName && accessoryName[0] ? accessoryName : "LYENA Sensor");
    copyText(gLyenaSerial, sizeof(gLyenaSerial), serialNumber && serialNumber[0] ? serialNumber : "SN000000");
    copyText(gLyenaModel, sizeof(gLyenaModel), model && model[0] ? model : "LH-T300-V7-LITE");
    copyText(gLyenaFirmware, sizeof(gLyenaFirmware), firmwareRevision && firmwareRevision[0] ? firmwareRevision : "2026.04");
}

homekit_characteristic_t lyena_cha_current_temperature = HOMEKIT_CHARACTERISTIC_(CURRENT_TEMPERATURE, 1.0);
homekit_characteristic_t lyena_cha_current_relative_humidity = HOMEKIT_CHARACTERISTIC_(CURRENT_RELATIVE_HUMIDITY, 50.0);
homekit_characteristic_t lyena_cha_temp_name = HOMEKIT_CHARACTERISTIC_(NAME, "Temperatura");
homekit_characteristic_t lyena_cha_hum_name = HOMEKIT_CHARACTERISTIC_(NAME, "Humedad");

homekit_accessory_t* lyena_accessories[] = {
    HOMEKIT_ACCESSORY(.id = 1, .category = homekit_accessory_category_sensor, .services = (homekit_service_t*[]) {
        HOMEKIT_SERVICE(ACCESSORY_INFORMATION, .characteristics = (homekit_characteristic_t*[]) {
            HOMEKIT_CHARACTERISTIC(NAME, gLyenaName),
            HOMEKIT_CHARACTERISTIC(MANUFACTURER, "LEYNA_HOME"),
            HOMEKIT_CHARACTERISTIC(SERIAL_NUMBER, gLyenaSerial),
            HOMEKIT_CHARACTERISTIC(MODEL, gLyenaModel),
            HOMEKIT_CHARACTERISTIC(FIRMWARE_REVISION, gLyenaFirmware),
            HOMEKIT_CHARACTERISTIC(IDENTIFY, lyena_accessory_identify),
            NULL
        }),
        HOMEKIT_SERVICE(TEMPERATURE_SENSOR, .primary = true, .characteristics = (homekit_characteristic_t*[]) {
            &lyena_cha_current_temperature,
            &lyena_cha_temp_name,
            NULL
        }),
        HOMEKIT_SERVICE(HUMIDITY_SENSOR, .characteristics = (homekit_characteristic_t*[]) {
            &lyena_cha_current_relative_humidity,
            &lyena_cha_hum_name,
            NULL
        }),
        NULL
    }),
    NULL
};

homekit_server_config_t lyena_homekit_config = {
    .accessories = lyena_accessories,
    .password = "123-45-678",
    .setupId = gLyenaSetupId
};

#endif
