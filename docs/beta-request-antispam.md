# Anti-spam de solicitudes beta (`submitBetaRequest`)

## Alcance
Este documento describe el control anti-spam aplicado al endpoint público `submitBetaRequest` en Cloud Functions.

Archivo de implementación:
- `functions/src/index.ts`

## Controles activos

### 1) Honeypot
Si el cliente envía contenido en `companyWebsite` o `website`, la solicitud se ignora de forma silenciosa.

Respuesta:
- `{ ok: true, ignored: true }`

### 2) Rate limit por IP hash
Se aplica limitación por `ipHash` (SHA-256 de `context.rawRequest.ip`) con bucket temporal.

Parámetros actuales:
- Colección de control: `betaRequestRateLimits`
- Máximo: `3` solicitudes
- Ventana: `24h`

Constantes en código:
- `BETA_RATE_LIMIT_COLLECTION`
- `BETA_RATE_LIMIT_MAX_REQUESTS`
- `BETA_RATE_LIMIT_WINDOW_MS`

#### Semántica
- Si excede cuota, la función devuelve la misma respuesta uniforme:
  - `{ ok: true, ignored: true }`
- Si está dentro de cuota, continúa el flujo normal (upsert en `betaRequests`).

## Trazabilidad operativa

Cuando una solicitud es ignorada:
- Se escribe log estructurado con:
  - `reason`: `honeypot` o `rate_limit`
  - `hasIpHash`: boolean
  - `emailDomain`: dominio del email (sin usuario)

En documento de rate limit se almacenan:
- `ipHash`
- `windowKey`
- `count`
- `windowStartMs`
- `windowEndsAtMs`
- `blockedCount`
- `limitedAt`
- `lastBlockedAt`
- `createdAt`
- `updatedAt`

## Ajustes en producción
Para cambiar política anti-spam:
1. Editar `BETA_RATE_LIMIT_MAX_REQUESTS` y/o `BETA_RATE_LIMIT_WINDOW_MS`.
2. Desplegar `functions`.
3. Monitorear logs de `reason=rate_limit` y tasa de conversión de leads.

## Riesgos conocidos
- NAT/proxy compartidos pueden concentrar múltiples usuarios reales detrás de una IP.
- Si sube tráfico legítimo, ajustar umbral/ventana o introducir excepciones controladas.
