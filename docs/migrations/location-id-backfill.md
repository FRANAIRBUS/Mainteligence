# Migración: backfill de `locationId` desde `siteId`

Esta migración rellena `locationId` cuando hay `siteId` legacy en:
- `users/{uid}`
- `organizations/{orgId}/members/{uid}` (collectionGroup `members`)

## Requisitos
- Credenciales de Firebase Admin configuradas (`GOOGLE_APPLICATION_CREDENTIALS`).
- Acceso al proyecto/entorno correcto.

## Ejecución
Dry-run (recomendado):
```
node functions/tools/migrations/5_backfill_location_ids.js --dry-run --scope=both
```

Ejecución real:
```
node functions/tools/migrations/5_backfill_location_ids.js --scope=both
```

Opcional: limitar el número de documentos:
```
node functions/tools/migrations/5_backfill_location_ids.js --dry-run --scope=users --limit=100
```

## Idempotencia
- Solo actualiza documentos sin `locationId` y con `siteId` presente.
- Puede ejecutarse múltiples veces sin duplicar cambios.

## Logs esperados
El script imprime:
- número de documentos leídos por colección
- número de documentos actualizados
- total de operaciones aplicadas

## Verificación (staging)
1. Ejecutar en dry-run.
2. Muestrear documentos:
   - `users/{uid}` con `siteId` → comprobar `locationId` asignado.
   - `organizations/{orgId}/members/{uid}` con `siteId` → comprobar `locationId`.

## Rollback
1. Restaurar desde backup si existe.
2. Alternativa: ejecutar un script inverso (si es necesario) para limpiar `locationId`
   únicamente cuando `locationId === siteId` y fue añadido por `source=migration_5_backfill_location_ids`.
