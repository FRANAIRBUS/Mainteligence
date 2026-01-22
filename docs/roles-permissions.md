# Definición de roles y permisos (RBAC)

Contrato implementable para control de acceso por rol y ámbito dentro de la **organización activa**.

## 0) Aislamiento por organización activa
- Un usuario puede pertenecer a varias organizaciones, pero **no hay acceso global**.
- Todas las operaciones están acotadas a la organización activa.
- Invariante duro: `doc.organizationId` debe ser igual a `activeOrgId`.

## 1) Roles
- `super_admin`
- `admin`
- `mantenimiento`
- `jefe_departamento`
- `jefe_ubicacion`
- `operario`
- `auditor` (solo lectura)

## 2) Campos obligatorios en el perfil (membership)
- `role`
- `organizationId`
- `departmentId` requerido para `jefe_departamento` y `operario`.
- `locationId` requerido para `jefe_ubicacion`.
- `departmentIds[]` y `locationIds[]` reservados para multi-pertenencia futura.

## 3) Campos mínimos en ticket/task
Obligatorios para permisos:
- `organizationId`
- `createdBy`
- `assignedTo` (opcional)
- `locationId` (opcional)
- `originDepartmentId` (opcional)
- `targetDepartmentId` (opcional)

## 4) Normalización para permisos
Antes de evaluar permisos:
- `docLoc = doc.locationId ?? null`
- `docOriginDept = doc.originDepartmentId ?? null`
- `docTargetDept = doc.targetDepartmentId ?? null`

Predicados:
- `isSameOrg = (doc.organizationId == activeOrgId)`
- `isCreator = (doc.createdBy == me.uid)`
- `isAssignee = (doc.assignedTo == me.uid)`
- `inMyDept = (docOriginDept == me.departmentId) || (docTargetDept == me.departmentId)`
- `inMyLoc = (docLoc != null) && (docLoc == me.locationId)`

## 5) Visibilidad (lectura)
Regla 0: si `!isSameOrg` ⇒ **DENY**.

- `super_admin` ⇒ **ALLOW** (todo en la org activa).
- `admin` ⇒ **ALLOW** (todo en la org activa).
- `mantenimiento` ⇒ **ALLOW** (todo en la org activa).
- `auditor` ⇒ **ALLOW** (lectura completa en la org activa).
- `jefe_departamento` ⇒ **ALLOW** si `inMyDept || isCreator || isAssignee`.
- `jefe_ubicacion` ⇒ **ALLOW** si `inMyLoc || isCreator || isAssignee`.
- `operario` ⇒ **ALLOW** si `isCreator || isAssignee || inMyDept`.

## 6) Matriz de acciones (tickets + tareas)
Todas las acciones presuponen `canReadDoc == true`, salvo crear.

| Acción | super_admin | admin | mantenimiento | jefe_departamento | jefe_ubicacion | operario | auditor |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Crear ticket/tarea | ✅ | ✅ | ✅ | ✅ (ámbito) | ✅ (ámbito) | ✅ (ámbito) | ❌ |
| Leer | ✅ | ✅ | ✅ | ✅ (ámbito + creador/asignado) | ✅ (ámbito + creador/asignado) | ✅ (según canRead) | ✅ |
| Editar contenido | ✅ | ✅ | ✅ | ✅ (inMyDept) | ✅ (inMyLoc) | ✅ si `isCreator` o `isAssignee` | ❌ |
| Comentar | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ si lo ve | ❌ |
| Asignar a usuario | ✅ | ✅ | ✅ | ✅ (solo usuarios de su depto) | ✅ (solo usuarios de su ubicación) | ⚠️ solo a sí mismo | ❌ |
| Cambiar depto/trasladar | ✅ | ✅ | ✅ | ✅ (ámbito) | ✅ (ámbito) | ✅ solo si abierto | ❌ |
| Cambiar prioridad | ✅ | ✅ | ✅ | ✅ (ámbito) | ✅ (ámbito) | ✅ si creador/asignado | ❌ |
| Cambiar estado | ✅ | ✅ | ✅ | ✅ (ámbito) | ✅ (ámbito) | ✅ si creador/asignado | ❌ |
| Completar tarea (`done`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ si asignado | ❌ |
| Marcar resuelta (`resolved`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ si asignado | ❌ |
| Solicitar cierre (`closure_requested`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ si creador/asignado | ❌ |
| Cerrar definitivamente (`closed`) | ✅ | ✅ | ✅ | ✅ (ámbito) | ✅ (ámbito) | ❌ | ❌ |
| Reabrir/Reasignar | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (solo quitarse a sí mismo) | ❌ |
| Ver auditoría | ✅ | ✅ | ✅ | ✅ (ámbito) | ✅ (ámbito) | ✅ solo docs visibles | ✅ |

## 7) Asignación de usuarios (validación dura)
- `super_admin` / `admin` / `mantenimiento`: cualquier usuario de la org activa.
- `jefe_departamento`: solo usuarios con `departmentId == me.departmentId`.
- `jefe_ubicacion`: solo usuarios con `locationId == me.locationId`.
- `operario`: solo auto-asignación.
- `auditor`: nunca asigna.

## 8) Workflow de cierre (operario)
- Operario puede solicitar cierre con `status = "closure_requested"` si es creador/asignado.
- Debe registrar `closureRequestedBy` y `closureRequestedAt`.
- Cierre definitivo lo confirma un rol superior.
