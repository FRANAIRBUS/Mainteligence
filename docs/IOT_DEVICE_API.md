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
