# Definición de roles y permisos (RBAC)

Referencia implementable para el control de acceso por rol y ámbito de departamento/organización.

## Campos obligatorios en el perfil
- `role`: `super_admin` | `admin` | `mantenimiento` | `jefe_departamento` | `jefe_ubicacion` | `operario` | `auditor`
- `organizationId`: siempre presente.
- `departmentId`: requerido para `jefe_departamento` y `operario`.
- `departmentIds[]`: reservado para multi-pertenencia futura.
- `locationId`: requerido para `jefe_ubicacion` (legacy: `siteId`).
- `locationIds[]`: reservado para multi-pertenencia futura (legacy: `siteIds[]`).

## Visibilidad de incidencias/tickets
- **super_admin**: todos los tickets (todas las organizaciones si aplica multi‑org).
- **admin / mantenimiento**: todos los tickets dentro de su `organizationId`.
- **jefe_departamento**: tickets donde `originDepartmentId` o `targetDepartmentId` estén en su `departmentId`, o si es `createdBy` / `assignedTo`.
- **jefe_ubicacion**: tickets en su `locationId`, o si es `createdBy` / `assignedTo`.
- **operario**: tickets creados por él, asignados a él, o asociados a su `departmentId`/`locationId`.
- **auditor**: lectura global.

> Base de compatibilidad: si un ticket solo tiene `departmentId`, se trata como `originDepartmentId/targetDepartmentId`.

## Matriz de acciones

| Acción | super_admin | admin | mantenimiento | jefe_departamento | jefe_ubicacion | operario | auditor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Crear incidencia/tarea | ✅ | ✅ | ✅ | ✅ (en su ámbito) | ✅ (en su ámbito) | ✅ (en su ámbito) | ❌ |
| Leer | ✅ | ✅ (org) | ✅ (org) | ✅ (su depto) | ✅ (su sitio) | ✅ (según visibilidad base) | ✅ |
| Editar contenido | ✅ | ✅ | ✅ | ✅ (su depto) | ✅ (su sitio) | ✅ si `createdBy==me` o `assignedTo==me` | ❌ |
| Comentar | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (si lo ve) | ❌ |
| Asignar a usuario | ✅ | ✅ | ✅ | ✅ (solo usuarios de su ámbito) | ✅ (solo usuarios de su ámbito) | ⚠️ Solo a sí mismo o a cola/departamento | ❌ |
| Trasladar de departamento | ✅ | ✅ | ✅ | ✅ (su depto) | ✅ (su sitio) | ✅ mientras esté abierta y no cerrada | ❌ |
| Cambiar prioridad | ✅ | ✅ | ✅ | ✅ (su depto) | ✅ (su sitio) | ✅ excepto subir a "Crítica" si se desea limitar | ❌ |
| Cambiar estado | ✅ | ✅ | ✅ | ✅ (su depto) | ✅ (su sitio) | ✅ solo si es creador/asignado | ❌ |
| Completar tarea | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (si está asignada) | ❌ |
| Marcar incidencia resuelta | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (si está asignada) | ❌ |
| Solicitar cierre | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (creador/asignado marca `Cierre solicitado`) | ❌ |
| Cerrar definitivamente | ✅ | ✅ | ✅ | ✅ (su depto) | ✅ (su sitio) | ❌ (usa solicitud de cierre) | ❌ |
| Reabrir/Reasignar | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (solo quitarse a sí mismo) | ❌ |
| Ver auditoría | ✅ | ✅ | ✅ | ✅ (su depto) | ✅ (su sitio) | ✅ solo su ticket | ✅ |
| Editar ajustes de organización | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Asignar roles / crear admins | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

## Reglas específicas de operario
- Puede asignarse a sí mismo o a una "cola" (departamento destino), pero no elegir cualquier usuario.
- Puede pedir cierre marcando `status = "in_progress"` con metadata de solicitud (`closureRequestedBy`, `closureRequestedAt`).
- No puede cerrar; un rol superior confirma cambiando a `resolved`.
- Si una tarea está asignada a él, puede marcar `status = "done"`; un jefe puede reabrir/reasignar.

## Ámbito de jefes de departamento
Un jefe de departamento puede actuar cuando el ticket pertenece a su ámbito:
- `originDepartmentId` está en sus departamentos, o
- `targetDepartmentId` está en sus departamentos.
