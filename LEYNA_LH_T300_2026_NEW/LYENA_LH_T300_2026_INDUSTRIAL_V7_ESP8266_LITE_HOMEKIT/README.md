# LYENA LH T300 Industrial V7 ESP8266 Lite HomeKit

Base firmware industrial orientada a ESP8266 con scheduler cooperativo `EdgeLite`. Esta variante elimina el stack Modbus para reducir uso de RAM/flash y añade bridge Apple HomeKit (si la libreria está instalada), manteniendo provisioning, captive portal, OTA y API local.

## Objetivos de esta variante Lite

- Multitarea cooperativa con `EdgeLite`.
- Firmware mas liviano en ESP8266 (sin runtime Modbus).
- HomeKit integrado como tarea Edge (`homeKitDriver`) para evitar desbordes por bloqueo en loop principal.
- Provisioning nativo sin dependencia de AutoConnect.
- AP fallback con portal `/setup` y captive DNS.
- HMI local en `/app` y API JSON en `/api/v1/*`.
- Persistencia JSON versionada en `/lh_v4_config.json`.
- Activacion en caliente del runtime operativo sin reinicio forzado al guardar conectividad.
- OTA integrada y desacoplada del portal de provisioning.
- Base comun ESP8266/ESP32 con compatibilidad centralizada.
- Provisioning Cloud IoT por JSON, codigo concatenado, QR o campos manuales.
- URLs IoT por defecto (`us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceBootstrap` y `us-central1-studio-4350140400-a3f8f.cloudfunctions.net/iotDeviceSync`) con compatibilidad de endpoints legacy.

## Modulos principales

- `LYENA_LH_T300_2026_INDUSTRIAL_V7_ESP8266_LITE_HOMEKIT.ino`: arranque y loop principal.
- `IndustrialApp.*`: scheduler, sensores, control, conectividad, OTA y persistencia.
- `WebUi.*`: HMI industrial, setup portal y rutas `/api/v1/*`.
- `webui/*.html`: fuentes editables de la UI embebida (app/setup/ota).
- `tools/webui_sync.py`: sincroniza `webui/*.html` <-> blobs gzip en `WebUi.cpp`.
- `AppConfig.*`: defaults, saneado y serializacion JSON.
- `BoardCompat.h`: diferencias ESP8266/ESP32, filesystem, mDNS, heap y hostname.
- `MaintCloud.*`: puente cloud/Firebase para bootstrap y desired state.
- `LogBuffer.*`: buffer circular de logs.

## Edicion WebUI

El firmware intenta cargar primero desde filesystem y, si no existe el archivo, usa fallback embebido en `WebUi.cpp`.

Rutas filesystem soportadas:
- `/webui/app.html`
- `/webui/setup.html`
- `/webui/ota.html`
- `/webui/custom-program.html`

1. Extraer HTML editable desde `WebUi.cpp`:
   - `python tools/webui_sync.py extract`
2. Editar archivos en `webui/` (`app.html`, `setup.html`, `ota.html`, `custom-program.html`).
3. Reempaquetar en `WebUi.cpp`:
   - `python tools/webui_sync.py pack`

La pagina `/app` incluye accesos directos a:
- `/custom-program`
- `/setup`
- `/ota`

## Provisioning y operacion

- Si no hay configuracion valida, el equipo arranca en modo seguro y expone el portal `/setup`.
- El AP de provisioning usa el hostname configurado mas sufijo de chip.
- Password AP por defecto: `12345678`.
- El captive DNS redirige navegacion arbitraria al portal local.
- La app operativa queda en `/app`.
- La API principal expone `/api/v1/state`, `/api/v1/config`, `/api/v1/control`, `/api/v1/logs`, `/api/v1/network` y `/api/v1/wifi-scan`.

## Capacidades incluidas

- Modos `disabled`, `thermostat`, `pushbutton` y `manual`.
- Sensores `DS18B20`, `DHT11`, `DHT22`, `ON/OFF`, `NTC`, `PTC`, `PT100`, `internal` y `analog linear` (mapeo V -> valor).
- Cuatro reles y cuatro entradas.
- Alarmas, defrost y control por setpoint.
- Bridge Cloud IoT/Firebase (bootstrap + sync + desired state).
- OTA autenticable con password dedicada o `adminPass` como fallback.
- Publicacion HomeKit de temperatura y humedad del canal 1 (cuando la libreria HomeKit esta disponible).

## Dependencias esperadas

- `EdgeLite`
- `ArduinoJson`
- `DallasTemperature`
- `OneWire`
- `DHT sensor library`
- `arduino-homekit-esp8266` (opcional, para habilitar HomeKit real)

## Dependencias eliminadas

- `AutoConnect`
- `PageBuilder`
- `EdgeUnified-eval-master` como dependencia obligatoria del proyecto

## Nota de migracion del scheduler

Las versiones anteriores usaban `EdgeUnified-eval-master`, que arrastraba dependencias asociadas al ecosistema AutoConnect/PageBuilder.  
La variante V7 Lite usa solo la base del scheduler cooperativo (`EdgeLite`).

Por compatibilidad, puede mantenerse temporalmente:

```cpp
#include <EdgeUnified.h>
