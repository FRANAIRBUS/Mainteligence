# LEYNA LH T300 Industrial V6

Base firmware industrial para ESP8266 y ESP32 orientada a fiabilidad operativa. Esta version mantiene EdgeUnified como scheduler cooperativo, elimina AutoConnect de la ruta critica y lo sustituye por una capa nativa de conectividad con portal propio, AP de provisioning, captive DNS y OTA.

## Objetivos de la V6

- Multitarea cooperativa con `EdgeUnified-eval-master`.
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

- `LEYNA_LH_T300_2026_INDUSTRIAL_V6.ino`: arranque y loop principal.
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
- `/webui/modbus-map.html`
- `/webui/custom-program.html`

1. Extraer HTML editable desde `WebUi.cpp`:
   - `python tools/webui_sync.py extract`
2. Editar archivos en `webui/` (`app.html`, `setup.html`, `ota.html`, `modbus-map.html`, `custom-program.html`).
3. Reempaquetar en `WebUi.cpp`:
   - `python tools/webui_sync.py pack`

La pagina `/app` incluye accesos directos a:
- `/modbus-map`
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
- Sensores `DS18B20`, `DHT11`, `DHT22`, `ON/OFF`, `NTC`, `PTC`, `PT100` e `internal`.
- Cuatro reles y cuatro entradas.
- Alarmas, defrost y control por setpoint.
- Bridge Cloud IoT/Firebase (bootstrap + sync + desired state).
- Modbus RTU server, Modbus TCP server, puente TCP to RTU y modo Slave to Me con registros configurables.
- OTA autenticable con password dedicada o `adminPass` como fallback.

## Dependencias esperadas

- `EdgeUnified-eval-master`
- `AutoConnect` (dependencia de compilacion transitiva de EdgeUnified, aunque V6 ya no lo usa como portal)
- `ArduinoJson`
- `modbus-esp8266`
- `DallasTemperature`
- `OneWire`
- `DHT sensor library`

## Notas de fiabilidad

- El guardado de configuracion verifica escritura y parseo antes de aceptarse.
- El cambio de conectividad recarga WiFi/AP/OTA sin reinicio automatico.
- El primer commissioning puede activar pines, sensores y runtime en caliente.
- Si cambia la topologia Modbus ya armada, se recomienda reinicio controlado antes de produccion.
- Los modos RTU, TCP to RTU y Slave to Me requieren ESP32 con RS485 conectado en los pines RTU configurados.
- `Factory reset` elimina el fichero de configuracion y devuelve el equipo a commissioning seguro.

## Validacion pendiente fuera de este entorno

- Compilacion real en IDE Arduino o `arduino-cli` para ESP8266 y ESP32.
- Pruebas HIL con el mapa de pines definitivo.
- Soak test de WiFi, captive portal, OTA, Modbus y Cloud IoT.
- Ajuste del portal `/setup` y del HMI `/app` contra tu flujo de planta y mantenimiento.



