#line 1 "C:\\Users\\FRAN\\Documents\\Arduino\\LYENA_LH_T300_2026_NEW\\LYENA_LH_T300_2026_INDUSTRIAL_V7_ESP8266_LITE_HOMEKIT\\LYENA_LH_T300_2026_INDUSTRIAL_V7_ESP8266_LITE_HOMEKIT.ino"
#include <Arduino.h>

#include "IndustrialApp.h"

using namespace industrial_v2;

void setup() {
  Serial.begin(115200);
  delay(50);
  initializeApplication();
}

void loop() {
  const uint32_t startUs = micros();
  processApplication();
  recordLoopDuration(micros() - startUs);
}

