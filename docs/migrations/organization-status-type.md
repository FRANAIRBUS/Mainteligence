# Backfill organization status/type

## Objetivo
Normalizar `type` y `status` en `organizations` y `organizationsPublic`, derivando:
- `type`: `demo` si el `orgId` empieza por `demo-` o existe `demoExpiresAt`, si no `standard`.
- `status`: `suspended` cuando `isActive === false`, si no `active`.

## Requisitos
- Credenciales con acceso a Firestore (por ejemplo `GOOGLE_APPLICATION_CREDENTIALS`).
- Node.js 20+.

## Ejecución
Desde `functions/tools/migrations`:

```bash
node 4_backfill_org_status_type.js --dry-run
node 4_backfill_org_status_type.js
```

Opcionalmente limita el número de organizaciones:

```bash
node 4_backfill_org_status_type.js --limit=50
```

## Rollback
Este script hace `merge` en los documentos. Si necesitas revertir:
1. Restaura desde backup.
2. O elimina manualmente los campos `type`/`status`/`isActive` añadidos por el script.
