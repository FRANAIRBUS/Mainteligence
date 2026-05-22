#pragma once

namespace industrial_v2 {

struct AppConfigData;
struct AppRuntimeData;

void homekitBridgeBegin(const AppConfigData& config);
void homekitBridgeProcess(const AppRuntimeData& runtime);
void homekitBridgeResetPairings();
const char* homekitBridgeStatus();

}  // namespace industrial_v2
