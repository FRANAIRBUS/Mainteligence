# Gestión de planes por organización

## 1) Dónde se aplican los planes en la app

Los planes se aplican en `organizations/{orgId}.entitlement`.

Validaciones efectivas (backend):

- Estado de entitlement (`trialing|active|past_due|canceled`).
- Vencimiento de trial (`trialEndsAt`).
- Límites (`entitlement.limits`) vs consumo (`entitlement.usage`).
- Features por plan desde `planCatalog/{planId}`.

La pantalla `/plans` en frontend sigue siendo informativa/comercial; no muta plan directamente.

## 2) Planes disponibles

`planId` soportados:

- `free`
- `starter`
- `pro`
- `enterprise`

`entitlement.status` soportados:

- `trialing`
- `active`
- `past_due`
- `canceled`

`organization.status` soportados:

- `active`
- `suspended`
- `deleted`


## 2.1) Límite operativo de preventivos por plan

- `demo`: 5 plantillas preventivas (tope de demo).
- `free`: 3 preventivos activos.
- `pro`: 100 preventivos activos.
- `enterprise`: 1000 preventivos activos.

Notas:
- La habilitación de preventivos se rige por `features.PREVENTIVES` en `planCatalog/{planId}` con fallback seguro por defecto en backend.
- El límite efectivo se normaliza en backend por `planId` para evitar inconsistencias históricas en `entitlement.limits`.

## 3) Cambio de plan como usuario de organización

Como usuario de organización (super_admin), el cambio de plan productivo se realiza por proveedor de billing:

1. Stripe (`stripeWebhook`).
2. Apple App Store (`appleAppStoreNotifications`).
3. Google Play (registro de compra para reconciliación de entitlement).

No existe self-service real de upgrade/downgrade en `/plans`.

## 4) Cambio de plan/estado como ROOT

Existe callable oficial:

- `rootSetOrganizationPlan` (solo claim `root`).

Existe UI root en `/root` para ejecutar esta operación en “Zona peligrosa” con confirmación estricta por `organizationId`.

Campos operativos:

- `planId`: `free|starter|pro|enterprise`
- `entitlementStatus`: `trialing|active|past_due|canceled`
- `organizationStatus`: `active|suspended|deleted`
- `reason`: obligatorio (auditoría)

## 5) Contrato operativo recomendado (payload)

Ejemplo de llamada:

```json
{
  "organizationId": "acme-prod",
  "planId": "pro",
  "entitlementStatus": "active",
  "organizationStatus": "active",
  "provider": "manual",
  "reason": "Upgrade aprobado por soporte L2 / ticket OPS-1234"
}
```

Notas:

- `organizationId` y `reason` son obligatorios.
- Si no se envía `planId` ni `entitlementStatus`, no se aplica cambio de entitlement.
- Si se envía `organizationStatus`, se sincroniza también `organizationsPublic/{orgId}` (`status` + `isActive`).
- Si el `planId` no existe en `planCatalog`, ROOT puede aplicar override manual; queda advertencia en logs y traza en auditoría (`planCatalogFound=false`).

## 6) Guardrails de seguridad y consistencia

`rootSetOrganizationPlan` aplica controles:

- Solo ROOT (custom claim).
- Validación estricta de estados.
- Intento de validación en `planCatalog` cuando se envía `planId`; si no existe, se permite override manual con warning y trazabilidad.
- Preserva `entitlement.usage` y `entitlement.limits` al cambiar plan/estado.
- Escribe traza manual en `billingProviders.manual`.
- Registra `auditLog` con `before/after`, actor y `reason`.

## 7) Procedimiento correcto de operación

1. Seleccionar organización en `/root`.
2. Confirmar `organizationId` exacto en “Zona peligrosa”.
3. Definir `planId`, `entitlementStatus`, `organizationStatus`.
4. Completar `reason` con referencia de ticket/aprobación.
5. Ejecutar “Aplicar plan/estado”.
6. Verificar resultado:
   - `organizations/{orgId}.entitlement`
   - `organizations/{orgId}.billingProviders.manual`
   - `organizations/{orgId}.status`/`isActive`
   - `organizationsPublic/{orgId}.status`/`isActive`
   - `auditLogs`.
