# IoT Device API

## Objetivo
Integrar ESP32/ESP8266 con Maintelligence usando:
- bootstrap seguro de un solo uso
- telemetria por HTTPS firmada
- control bidireccional mediante `desiredState` y `reportedState`

## Flujo recomendado
1. En Maintelligence crear el activo IoT.
2. Desde `/iot` generar bootstrap token.
3. Copiar al ESP:
   - `organizationId`
   - `deviceKey`
   - `bootstrapToken`
   - `bootstrapUrl`
   - `syncUrl`
4. El ESP llama a `iotDeviceBootstrap` una vez.
5. El backend devuelve `deviceSecret`.
6. El ESP guarda `deviceSecret` en memoria persistente.
7. El ESP llama periodicamente a `iotDeviceSync` firmando cada peticion.
8. Maintelligence actualiza `desiredState` cuando un admin envie una orden.
9. El ESP aplica localmente el cambio y responde con `reportedState`.

## Endpoints
### POST `iotDeviceBootstrap`
Body JSON:
```json
{
  "organizationId": "org_demo",
  "deviceKey": "LH-T300-01",
  "bootstrapToken": "token-temporal",
  "firmwareVersion": "1.0.0",
  "capabilities": ["setpoint", "power", "mode", "fan"]
}
```

Respuesta:
```json
{
  "ok": true,
  "organizationId": "org_demo",
  "assetId": "asset123",
  "deviceKey": "LH-T300-01",
  "deviceSecret": "secreto-largo",
  "syncUrl": "https://.../iotDeviceSync",
  "pollIntervalMs": 15000
}
```

Campos recomendados para control remoto de entradas virtuales:

```json
{
  "desiredState": {
    "pulseVirtualInput": "VIN1"
  }
}
```

Opcional (si se quiere forzar estado mantenido):

```json
{
  "desiredState": {
    "virtualInputs": {
      "VIN1": false,
      "VIN2": true,
      "VIN3": false,
      "VIN4": false
    }
  }
}
```

### POST `iotDeviceSync`
Headers:
- `x-maint-org-id`
- `x-maint-device-key`
- `x-maint-ts`
- `x-maint-signature`

Firma:
- HMAC SHA256
- mensaje: `${timestamp}.${rawJsonBody}`
- clave: `deviceSecret`

Body JSON ejemplo:
```json
{
  "reportedState": {
    "temperature": 4.2,
    "humidity": 81,
    "setpoint": 4.5,
    "status": "online",
    "mode": "cool",
    "firmwareVersion": "1.0.0",
    "appliedDesiredVersion": 3,
    "applyStatus": "applied",
    "applyMessage": "Setpoint actualizado",
    "raw": {
      "Temp1": "4.2",
      "Hum1": "81",
      "Set1": "4.5",
      "REL1": "1"
    }
  },
  "capabilities": ["setpoint", "power", "mode", "fan"],
  "storeTelemetry": true
}
```

## Callables para graficas y descarga
### `getAssetIotTelemetry`
Uso desde cliente autenticado (miembro activo de la organizacion):

Payload:
```json
{
  "organizationId": "org_demo",
  "payload": {
    "assetId": "asset123",
    "from": "2026-03-10T00:00:00.000Z",
    "to": "2026-03-12T23:59:59.999Z",
    "limit": 1000
  }
}
```

Respuesta:
```json
{
  "ok": true,
  "organizationId": "org_demo",
  "assetId": "asset123",
  "from": "2026-03-10T00:00:00.000Z",
  "to": "2026-03-12T23:59:59.999Z",
  "limit": 1000,
  "count": 452,
  "rows": [
    {
      "id": "reading1",
      "readingAt": "2026-03-11T12:00:00.000Z",
      "createdAt": "2026-03-11T12:00:01.000Z",
      "temperature": 4.2,
      "humidity": 81,
      "status": "online"
    }
  ]
}
```

### `exportAssetIotTelemetryCsv`
Devuelve un CSV listo para descargar con cabeceras:

- `readingAt`
- `createdAt`
- `temperature`
- `secondaryTemperature`
- `humidity`
- `setpoint`
- `power`
- `mode`
- `fan`
- `status`
- `applyStatus`
- `applyMessage`
- `firmwareVersion`
- `uptimeSeconds`
- `relays`
- `alarms`
- `raw`

Payload:
```json
{
  "organizationId": "org_demo",
  "payload": {
    "assetId": "asset123",
    "from": "2026-03-10T00:00:00.000Z",
    "to": "2026-03-12T23:59:59.999Z",
    "limit": 5000
  }
}
```

Respuesta:
```json
{
  "ok": true,
  "filename": "telemetry_org_demo_asset123_2026-03-10_2026-03-12.csv",
  "contentType": "text/csv; charset=utf-8",
  "count": 452,
  "csv": "readingAt,createdAt,..."
}
```

Respuesta:
```json
{
  "ok": true,
  "organizationId": "org_demo",
  "assetId": "asset123",
  "deviceKey": "LH-T300-01",
  "desiredState": {
    "version": 4,
    "setpoint": 3.8,
    "power": true,
    "mode": "cool",
    "fan": "auto"
  },
  "serverTime": "2026-03-11T12:00:00.000Z",
  "pollIntervalMs": 15000
}
```

## Firestore
### Activo
`organizations/{orgId}/assets/{assetId}`
- `iot.deviceKey`
- `iot.panelType`
- `iot.capabilities[]`
- `iot.lastReading`
- `iot.reportedState`
- `iot.desiredState`
- `iot.provisioning.*`

Campos reportados utiles para customProgram/secuencia:
- `iot.reportedState.customProgramValid`
- `iot.reportedState.customProgramMode`
- `iot.reportedState.customProgramError`
- `iot.reportedState.sequenceRunning`
- `iot.reportedState.sequenceState`
- `iot.reportedState.sequenceCurrentStep`
- `iot.reportedState.sequenceCurrentLoop`
- `iot.reportedState.sequenceError`
- `iot.reportedState.virtualInputs`

### Credencial privada del dispositivo
`iotDevices/{orgId}__{deviceKey}`
- `organizationId`
- `assetId`
- `deviceKey`
- `deviceSecret`
- `deviceSecretIssuedAt`
- `disabled`
- `lastSyncAt`

### Historico opcional
`organizations/{orgId}/assets/{assetId}/telemetry/{readingId}`

Campos persistidos por lectura:
- `organizationId`
- `assetId`
- `deviceKey`
- `reportedState`
- `createdAt`
- `expiresAt` (para TTL)

## Retencion y consultas
- Retencion por defecto: 90 dias.
- Configurable en Functions con la variable de entorno `IOT_TELEMETRY_RETENTION_DAYS`.
- Si el dispositivo no envia `storeTelemetry: true`, solo se actualiza el ultimo estado (`iot.lastReading`) y no se genera historico.

Indices definidos:
- `telemetry` por `organizationId + assetId + createdAt DESC` (graficas por activo/rango).
- `telemetry` por `organizationId + createdAt DESC` (descargas consolidadas por organizacion).

TTL:
- Se usa `expiresAt` para eliminar historico automaticamente al vencer la retencion.

## Notas de firmware
- El ESP no debe escribir en Firestore directamente.
- El ESP no debe guardar credenciales de usuario admin.
- El ESP solo necesita:
  - `organizationId`
  - `deviceKey`
  - `deviceSecret`
  - `syncUrl`
- El control Modbus sigue siendo local.
- La nube solo fija `desiredState`.
- El ESP traduce ese estado a Modbus/GPIO y confirma en `reportedState`.
