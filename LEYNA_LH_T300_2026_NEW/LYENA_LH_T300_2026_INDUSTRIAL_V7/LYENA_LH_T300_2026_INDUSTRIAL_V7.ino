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
