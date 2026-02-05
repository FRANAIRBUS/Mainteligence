# Gestión de planes por organización

## 1) Dónde se aplican los planes en la app

Los planes se aplican en el campo `organizations/{orgId}.entitlement`.

- El backend valida este `entitlement` antes de permitir altas de recursos (`sites`, `assets`, `departments`, `users`, `preventives`).
- Además de límites (`limits` + `usage`), se evalúan `status`, vencimiento de trial y features cargadas desde `planCatalog/{planId}`.

En frontend, la pantalla `/plans` solo visualiza el plan/uso actual y muestra CTA comerciales (mensual/anual), sin mutación directa del plan.

## 2) Planes disponibles hoy

Planes modelados en código:

- `free`
- `starter`
- `pro`
- `enterprise`

Estados de entitlement soportados:

- `trialing`
- `active`
- `past_due`
- `canceled`

## 3) Cómo cambia el plan un usuario (super_admin de una organización)

No existe hoy un flujo self-service que cambie plan desde `/plans`.

Flujos existentes:

1. **Stripe**: el cambio real de plan se consolida por webhook (`stripeWebhook`) y se aplica a `organizations/{orgId}.entitlement`.
2. **Apple App Store**: se registra vínculo org-token y las notificaciones aplican cambios de entitlement.
3. **Google Play**: se registra compra vinculada a la organización; el plan queda asociado al purchase token para actualización posterior.

Requisito de permisos para registrar compras/tokens desde callable: `super_admin` de la organización objetivo.

## 4) Cómo cambia planes un usuario root para cualquier organización

No existe actualmente un callable/admin action tipo `rootSetOrganizationPlan` ni UI root para editar plan directamente.

Con el código actual, root solo puede:

- listar organizaciones,
- ver resumen,
- mover usuarios,
- activar/desactivar organización,
- purgar colecciones o borrar scaffold.

Para cambiar planes de terceros hoy hay dos caminos operativos:

1. **Vía billing provider** (recomendado): provocar el evento de proveedor correcto (Stripe/Apple/Google) para que el backend aplique entitlement.
2. **Operación manual controlada** (no ideal): actualización directa de documento en Firestore por operador con privilegios de infraestructura, preservando consistencia de `entitlement` y `billingProviders`.

## 5) Procedimiento correcto recomendado (operación)

1. Confirmar `organizationId` destino.
2. Validar proveedor activo actual (`entitlement.provider`) y evitar mezcla de proveedores activos.
3. Ejecutar cambio en proveedor de billing (no en UI `/plans`).
4. Verificar recepción de webhook/notificación y actualización de:
   - `organizations/{orgId}.entitlement.planId`
   - `organizations/{orgId}.entitlement.status`
   - `organizations/{orgId}.billingProviders.{provider}`
5. Validar impacto funcional:
   - creación de activos/sitios/departamentos/usuarios según límites,
   - habilitación de features (`PREVENTIVES`, `EXPORT_PDF`, etc.) según `planCatalog`.
6. Registrar evidencia (audit logs + timestamps del provider).

## 6) Brecha actual y recomendación técnica

Para operación enterprise/multi-tenant, conviene agregar un callable explícito y auditado para root:

- `rootSetOrganizationPlan({ organizationId, planId, status, provider='manual', reason })`

Con controles:

- validación estricta de `planId` contra `planCatalog`,
- preservación de `usage` vigente,
- escritura de `billingProviders.manual`,
- bloqueo de override cuando haya provider activo conflictivo,
- `auditLog` obligatorio con actor root y motivo.
