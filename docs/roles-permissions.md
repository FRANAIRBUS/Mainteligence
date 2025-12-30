# Definición de roles y permisos (RBAC)

Referencia implementable para el control de acceso por rol y ámbito de departamento/organización.

## Campos obligatorios en el perfil
- `role`: `super_admin` | `admin` | `maintenance` | `dept_head_multi` | `dept_head_single` | `operator`
- `organizationId`: siempre presente.
- `departmentId`: requerido para `dept_head_single` y `operator`.
- `departmentIds[]`: requerido para `dept_head_multi`.
- `siteId` (opcional) si se usan sedes.

## Visibilidad de incidencias/tickets
- **super_admin**: todos los tickets (todas las organizaciones si aplica multi‑org).
- **admin / maintenance**: todos los tickets dentro de su `organizationId`.
- **dept_head_multi**: tickets donde `originDepartmentId` o `targetDepartmentId` estén en `departmentIds`, o si es `createdBy` / `assignedTo`.
- **dept_head_single**: igual que arriba usando `departmentId`.
- **operator**: tickets creados por él, asignados a él, o asociados a su `departmentId` (origen o destino).

> Base de compatibilidad: si un ticket solo tiene `departmentId`, se trata como `originDepartmentId/targetDepartmentId`.

## Matriz de acciones

| Acción | super_admin | admin | maintenance | dept_head_multi | dept_head_single | operator |
| --- | --- | --- | --- | --- | --- | --- |
| Crear incidencia/tarea | ✅ | ✅ | ✅ | ✅ (en su ámbito) | ✅ (en su ámbito) | ✅ (en su ámbito) |
| Leer | ✅ | ✅ (org) | ✅ (org) | ✅ (sus deptos) | ✅ (su depto) | ✅ (según visibilidad base) |
| Editar contenido | ✅ | ✅ | ✅ | ✅ (sus deptos) | ✅ (su depto) | ✅ si `createdBy==me` o `assignedTo==me` |
| Comentar | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (si lo ve) |
| Asignar a usuario | ✅ | ✅ | ✅ | ✅ (solo usuarios de sus deptos) | ✅ (su depto) | ⚠️ Solo a sí mismo o a cola/departamento |
| Trasladar de departamento | ✅ | ✅ | ✅ | ✅ (sus deptos) | ✅ (su depto) | ✅ mientras esté abierta y no cerrada |
| Cambiar prioridad | ✅ | ✅ | ✅ | ✅ (sus deptos) | ✅ (su depto) | ✅ excepto subir a "Crítica" si se desea limitar |
| Cambiar estado | ✅ | ✅ | ✅ | ✅ (sus deptos) | ✅ (su depto) | ✅ solo si es creador/asignado |
| Completar tarea | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (si está asignada) |
| Marcar incidencia resuelta | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (si está asignada) |
| Solicitar cierre | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (creador/asignado marca `Cierre solicitado`) |
| Cerrar definitivamente | ✅ | ✅ | ✅ | ✅ (sus deptos) | ✅ (su depto) | ❌ (usa solicitud de cierre) |
| Reabrir/Reasignar | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (solo quitarse a sí mismo) |
| Ver auditoría | ✅ | ✅ | ✅ | ✅ (sus deptos) | ✅ (su depto) | ✅ solo su ticket |
| Editar ajustes de organización | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Asignar roles / crear admins | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

## Reglas específicas de operador
- Puede asignarse a sí mismo o a una "cola" (departamento destino), pero no elegir cualquier usuario.
- Puede pedir cierre marcando `status = "Cierre solicitado"`, `closureRequestedBy` y `closureRequestedAt`.
- No puede cerrar; un rol superior confirma cambiando a `Cerrada`.
- Si una tarea está asignada a él, puede marcar `status = "completada"`; un jefe puede reabrir/reasignar.

## Ámbito de jefes de departamento
Un jefe (single o multi) puede actuar cuando el ticket pertenece a su ámbito:
- `originDepartmentId` está en sus departamentos, o
- `targetDepartmentId` está en sus departamentos.
