#pragma once

#include <Arduino.h>

namespace industrial_v2 {

bool iotCloudConfigured();
unsigned long iotCloudIntervalMs();
bool processIotCloud();

}  // namespace industrial_v2