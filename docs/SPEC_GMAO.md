# Especificación Premium — App GMAO Simple (Incidencias + Preventivos)
**Stack asumido:** Flutter (móvil) + React Web (panel admin) + Firebase (Auth, Firestore, Storage, Functions, FCM)  
**Documento “IA Implementer Brief”** — listo para repositorio y ejecución por programador humano o IA.

---

## 0) Visión general
### 0.1 Propósito
Desarrollar una aplicación tipo **GMAO simple y profesional** para:
- Registrar **incidencias correctivas** desde múltiples **localizaciones** (configurables).
- Gestionar la operativa del equipo de **mantenimiento** con bandeja común, estados, documentación y cierre.
- Crear **órdenes preventivas periódicas** mediante **plantillas** con checklists específicos por equipo.
- Generar un **informe de cierre** (email + PDF adjunto) de nivel profesional para auditoría y trazabilidad.

### 0.2 Principios de diseño (premium)
1. **Trazabilidad total:** toda acción relevante genera evento en timeline.
2. **Permisos mínimos:** cada rol ve y edita solo lo que debe (seguridad por diseño).
3. **Operativa realista:** estados + “En espera” + horas + repuestos + evidencias fotográficas.
4. **Configuración sin código:** localizaciones, departamentos, equipos y preventivos desde panel admin.
5. **Escalable sin rehacer:** soporte multi-localización y crecimiento de equipos/plantillas.
6. **Documentación automatizada:** PDF + email como salida natural de cada cierre.

---

## 1) Alcance
### 1.1 Incluido (Scope)
- **Correctivos (incidencias)**: creación por usuarios, seguimiento y cierre por mantenimiento.
- **Preventivos**: plantillas por equipo, generación automática cada X días, checklist, cierre.
- **Panel Admin (web)**: configuración y vista global con filtros avanzados.
- **Notificaciones push (FCM)**: nuevas incidencias y nuevas órdenes preventivas.
- **Informe de cierre**: email texto plano + PDF adjunto + PDF descargable.
- **Auditoría**: timeline/eventos + comentarios + adjuntos + partes.

### 1.2 Excluido (Non-scope por ahora)
- ERP completo o integración ERP (se deja preparado para futuro).
- Inventario formal de repuestos (solo registro manual).
- Firma biométrica o legal (opcional futuro).
- SLA avanzado con métricas complejas (se deja base con dueAt/overdue para preventivos).

---

## 2) Roles, permisos y reglas de negocio
### 2.1 Roles
- **Usuario estándar (operario)**  
  - Crea incidencias y **ve solo sus incidencias**.
  - Puede **cambiar prioridad** de sus incidencias (mientras no estén cerradas).
  - No puede cambiar estado, ni asignar técnicos, ni ver incidencias ajenas.

- **Mantenimiento (técnico)**  
  - Ve bandeja global de correctivos y preventivos dirigidos a mantenimiento.
  - Puede “tomar” (auto-asignarse), cambiar estado, documentar horas, repuestos, fotos.
  - Puede cerrar incidencias/órdenes cumpliendo reglas obligatorias.

- **Responsable de mantenimiento (sub-rol dentro del equipo de mantenimiento)**  
  - Mismos permisos de mantenimiento.
  - Además: permisos especiales definidos por admin (p. ej. reasignar, reabrir, forzar prioridad).  
  - Es **destinatario fijo** de emails de cierre.

- **Admin**  
  - Ve todo, cambia asignaciones/prioridades/departamentos, reabre/cierra.
  - Configura localizaciones, departamentos, equipos, usuarios/roles, plantillas preventivas.
  - Configura plantillas de informe (email/PDF) y destinatarios.

### 2.2 Visibilidad (decisión cerrada)
- Usuario estándar: **solo `createdBy = uid`**.
- Mantenimiento: ve todo lo destinado al rol de mantenimiento (bandeja común) + preventivos.
- Admin: ve todo.

### 2.3 Estados oficiales (decisión cerrada)
1) **Abierta**  
2) **En curso**  
3) **En espera**  
4) **Resuelta**  
5) **Cerrada**  

**Reglas:**
- El usuario estándar **no** puede cambiar estado.
- Si `status = En espera` → motivo y detalle obligatorios (ETA recomendada).
- `Resuelta` se permite como paso intermedio, pero no es obligatorio para cerrar.

### 2.4 Requisitos obligatorios al cerrar (decisión cerrada)
Para pasar a **Cerrada**:
- ✅ **Comentario de cierre** (resumen técnico y resultado).
- ✅ **Horas imputadas** (al menos un parte; se permite 0.0 pero registrado).
- ✅ Si es preventivo: **checklist 100% completado**.
- ✅ Si algún ítem checklist requiere nota o foto, debe cumplirse.

### 2.5 Destinatarios de email de cierre (decisión cerrada)
**Creador + Responsable de mantenimiento + Admins**  
(Implementar como lista dinámica configurable desde Admin; admitir emails de grupo).

---

## 3) Navegación y pantallas
### 3.1 App móvil (Flutter)
#### Usuario estándar
Tabs:
1. **Crear**
2. **Mis incidencias**
3. **Perfil**

Pantallas:
- Crear incidencia (formulario)
- Mis incidencias (listado + filtros básicos)
- Detalle incidencia (lectura + comentarios + añadir evidencias si permitido)
- Perfil (logout, datos)

#### Mantenimiento / Responsable
Tabs:
1. **Bandeja**
2. **Preventivos**
3. **Perfil**

Pantallas:
- Bandeja correctivos (filtros completos operativos)
- Preventivos (órdenes generadas)
- Detalle/ejecución de ticket (correctivo/preventivo)
- Cierre con informe
- Perfil

### 3.2 Panel Admin (React Web)
Menú:
- Dashboard
- Incidencias (global)
- Localizaciones
- Departamentos
- Equipos/Activos
- Usuarios y roles
- Preventivos (plantillas)
- Informes (plantillas email/PDF)
- Ajustes

---

## 4) Formularios funcionales (aprobados)
### 4.1 Crear incidencia (Usuario estándar)
**Obligatorio**
- Localización (site)
- Departamento
- Prioridad (Baja/Media/Alta/Crítica)
- Título
- Descripción

**Opcional**
- Equipo/Activo (filtrado por localización)
- “Detectado a las” (fecha/hora)
- Fotos (0–6 inicialmente)
- Nota para mantenimiento

**Resultado**
- Estado: Abierta
- Destino: assignedRole=mantenimiento, assignedTo=null
- Notificación a equipo mantenimiento

### 4.2 Cerrar incidencia/orden (Mantenimiento)
Secciones:
- Resumen (solo lectura)
- Estado (selector) + “Tomar incidencia”
- En espera (motivo/detalle/ETA) si aplica
- Checklist (si preventivo)
- Partes de horas (obligatorio al cerrar)
- Repuestos (si aplica)
- Evidencias (fotos antes/durante/después)
- Comentario de cierre (obligatorio)
- Botón “Cerrar y generar informe”

---

## 5) Catálogos iniciales y convención de códigos
### 5.1 Localizaciones iniciales
- Administración (`adm`)
- Tienda 1 (`t1`)
- Tienda 2 (`t2`)
- Obrador (`obr`)

### 5.2 Departamentos iniciales (cortos y configurables)
- Frío (`frio`)
- Electricidad (`elec`)
- IT / TPV (`it_tpv`)
- Mantenimiento general (`general`)
- Otros (`otros`)

### 5.3 Equipos iniciales (ejemplo)
- Obrador: Cámara frigorífica 1 (`cf1`), Cámara frigorífica 2 (`cf2`), Horno 1 (`horno1`)
- Tienda 1: Expositor 1 (`exo_t1_1`), Expositor 2 (`exo_t1_2`), TPV (`tpv_t1`)
- Tienda 2: Expositor 1 (`exo_t2_1`), TPV (`tpv_t2`)

---

## 6) Modelo de datos (Firestore) — definitivo
> Nota: Firestore genera IDs internos. Además tendremos `displayId` visible y profesional.

### 6.1 Colecciones base
- `users/{uid}`
- `organizations/{orgId}/sites/{siteId}`
- `organizations/{orgId}/departments/{deptId}`
- `organizations/{orgId}/assets/{assetId}`
- `organizations/{orgId}/tickets/{ticketId}`
  - `comments/{commentId}`
  - `events/{eventId}`
  - `timeEntries/{entryId}`
  - `parts/{partId}`
- `organizations/{orgId}/tasks/{taskId}`
- `organizations/{orgId}/auditLogs/{logId}`
- `organizations/{orgId}/settings/{settingId}`
- `preventiveTemplates/{templateId}`
- `counters/{orgId}/years/{YYYY}` (para `displayId`)

### 6.2 Users
Campos mínimos:
- `displayName`, `email`, `role` (operario|mantenimiento|admin)
- `isMaintenanceLead` (bool)
- `active` (bool)
- `siteIds[]` (opcional informativo)
- `createdAt`, `updatedAt`

### 6.3 Tickets (correctivo y preventivo)
Campos comunes:
- `displayId` (ej. `INC-2026-0007`, `PREV-OBR-CF1-2026-003`)
- `type`: `correctivo | preventivo`
- `status`: Abierta/En curso/En espera/Resuelta/Cerrada
- `priority`: Baja/Media/Alta/Crítica
- `siteId`, `departmentId`, `assetId?`
- `title`, `description`
- `createdBy`, `createdAt`, `updatedAt`
- `assignedRole = "mantenimiento"`
- `assignedTo?` (uid o null)
- `waiting?` (solo si en espera): `{reason, detail, eta}`
- `photoUrls[]`
- `lastCommentAt`
- `closedAt?`, `closedBy?`
- `reportPdfUrl?`, `emailSentAt?`

Campos preventivo extra:
- `templateId`
- `templateSnapshot` (name, frequencyDays)
- `preventive`:  
  - `frequencyDays`, `scheduledFor`, `checklist[]` (instancia)

### 6.4 Checklist instanciado (en ticket preventivo)
Cada item:
- `itemId`, `title`, `order`
- `result`: `OK|NOK|NA`
- `note` (obligatorio si NOK y requiresNoteIfFail)
- `requiresPhoto`, `requiresNoteIfFail`
- `photoUrls[]`
- `completedAt`, `completedBy`

### 6.5 Comments
- `type`: comment|status_change|assignment
- `text`, `createdBy`, `createdAt`

### 6.6 Events (timeline/auditoría)
Tipos:
- created, priority_changed, status_changed, assigned_changed,
- waiting_set, waiting_cleared,
- comment_added, photo_added,
- time_entry_added, part_added,
- closed, reopened,
- report_generated, email_sent

Campos:
- `at`, `by`, `type`, `summary`, `data{...}`

### 6.7 Time entries (horas)
- `date`, `technicianUid`, `hours` (float), `description`

### 6.8 Parts (repuestos)
- `name`, `qty`, `note`, `cost?`

### 6.9 Preventive templates
Campos:
- Identificación: `name`, `siteId`, `assetId`, `departmentId`, `defaultPriority`, `active`
- Programación: `frequencyDays`, `startDate`, `notifyDaysBefore?`, `oneActiveInstance=true`
- Escalado vencimiento: `overdueEscalation{enabled, escalateAfterDays, newPriority}`
- Checklist: `checklistItems[]` con `title`, `order`, `requiresPhoto`, `requiresNoteIfFail`, `severityIfFail?`
- Auditoría: `createdBy`, `createdAt`, `updatedAt`

### 6.10 Formato de IDs visibles (displayId)
- Correctivo: `INC-{YYYY}-{NNNN}` (contador anual)
- Preventivo: `PREV-{SITE}-{ASSET}-{YYYY}-{NNN}`

Contadores:
- `counters/{orgId}/years/{YYYY}`: `{inc: 42, prev: 12}`

---

## 7) Ordenación y filtros (premium)
### 7.1 Orden por defecto (decisión cerrada)
- `createdAt ASC` (más antigua → más nueva)
- A igualdad de fecha: prioridad `Crítica > Alta > Media > Baja`

Además: selector de orden alternativo (prioridad primero, actualización, vencimiento, etc.).

### 7.2 Filtros (Admin) — “todos los posibles”
**Identificación/búsqueda:** por displayId, título, descripción, equipo, creador  
**Tipo:** correctivo/preventivo/todos  
**Estado:** multiselección  
**Prioridad:** multiselección  
**Fechas (rangos):** creación, actualización, cierre, vencimiento(dueAt), “en espera desde” (si se registra)  
**Organización:** localización, departamento, equipo/activo  
**Asignación:** sin asignar, asignadas a mí, asignadas a técnico X  
**Solicitante:** creador (selector), email  
**Preventivos:** plantilla, frecuencia, scheduledFor, vencida, checklist con NOK, NOK críticos  
**Documentación:** con fotos, nº fotos, con horas, rango de horas, con repuestos, con PDF, email enviado, reabiertas  
**Espera:** motivo, ETA con/sin fecha  
**Tags:** si se activan

### 7.3 Filtros (Mantenimiento)
Incluye la mayoría operativa: estado, prioridad, localización, depto, equipo, asignación, en espera+motivo, tipo, vencidas, rangos de fecha, checklist NOK (preventivos).

### 7.4 Vistas guardadas
- Críticas/Altas (no cerradas)
- En espera
- Vencidas
- Preventivos de esta semana
- Sin asignar
- Cerradas hoy/semana

---

## 8) Preventivos — generación automática (definición)
### 8.1 Regla principal
Cada plantilla define **cada X días** (`frequencyDays`) y se gestiona de forma independiente.

### 8.2 Evitar duplicados (decisión recomendada)
**Una única orden activa por plantilla** (`oneActiveInstance=true`).  
Mientras una orden generada no se cierre, el sistema no crea una nueva (evita spam y descontrol).

### 8.3 Cálculo de la siguiente generación
- Si existe `lastClosedAt` para la plantilla: `nextDue = lastClosedAt + frequencyDays`
- Si no existe histórico: `nextDue = startDate + frequencyDays` (o startDate si se desea crear inmediata).

### 8.4 Vencidas / escalado
- Una orden puede marcarse `overdue=true` si `now > dueAt`.
- Si `overdueEscalation.enabled`, al superar `escalateAfterDays` se eleva prioridad automáticamente.

---

## 9) Notificaciones (FCM)
### 9.1 Eventos que notifican
- Ticket correctivo creado → notificar a **todos** los usuarios rol mantenimiento.
- Orden preventiva generada → notificar a **todos** los usuarios rol mantenimiento.
- (Opcional) Cambio a En espera → notificar al creador (informativo).
- (Opcional) Cierre → notificar al creador (además de email).

### 9.2 Gestión de tokens
- Guardar tokens por dispositivo en `users/{uid}/devices/{deviceId}` con `{token, platform, updatedAt}`.

---

## 10) Cierre: email + PDF (premium)
### 10.1 Email texto plano (plantilla base)
Asunto:
`[CIERRE MANTENIMIENTO] {ID} | {LOCALIZACIÓN} | {DEPARTAMENTO} | {PRIORIDAD} | {EQUIPO}`

Cuerpo: (ver plantilla aprobada en memoria; configurable desde admin).

### 10.2 PDF (índice)
- Cabecera/portada: empresa, ID, tipo, localización, equipo, prioridad, fechas
- Datos generales + descripción inicial
- Timeline de eventos
- Ejecución: comentario de cierre, horas, repuestos
- Checklist (si preventivo)
- Evidencias fotográficas (miniaturas o enlaces)
- Cierre: cerrado por, fecha, observaciones

### 10.3 Destinatarios
- Creador
- Responsable mantenimiento (isMaintenanceLead=true)
- Admins (role=admin) o email de grupo configurable

---

## 11) Seguridad (Auth + Rules)
### 11.1 Estrategia de roles
- Guardar `role` y `isMaintenanceLead` en `users/{uid}`.
- Opcional reforzar con **custom claims** (fase 2).

### 11.2 Reglas clave (resumen)
- Usuario estándar: read/write solo tickets `createdBy == uid`, sin tocar `status`/`assignedTo`.
- Mantenimiento: read tickets asignados a mantenimiento o a su uid; write para status/hours/parts/checklist.
- Admin: acceso total + configuración.
- Storage: permitir subir imágenes solo si el usuario tiene acceso al ticket.

> Implementación: pegar rules base ya definidas y ajustarlas a estos permisos.

---

## 12) Arquitectura de repositorio (monorepo recomendado)
```
repo/
  apps/
    mobile_flutter/
    admin_web_react/
  firebase/
    functions/
    firestore.rules
    storage.rules
    firestore.indexes.json
  docs/
    SPEC_GMAO.md
```
Este documento debe guardarse como `docs/SPEC_GMAO.md`.

---

## 13) Plan de implementación (Backlog con orden de trabajo)
> Cada historia incluye criterios de aceptación (CA).

### ÉPICA 1 — Base del proyecto
**H1.1** Crear proyecto Firebase y entornos (dev/prod)  
- CA: Auth habilitado, Firestore/Storage/Functions activos, hosting listo para admin web.

**H1.2** Estructura monorepo + CI básica  
- CA: build móvil y build web pasan en pipeline (si aplica).

### ÉPICA 2 — Auth y perfiles
**H2.1** Login/Logout Flutter + perfil básico  
- CA: usuario puede iniciar sesión y ver su rol; guardado en `users/{uid}`.

**H2.2** Gestión de usuarios/roles en Admin Web  
- CA: admin crea/edita roles, activa/desactiva, marca responsable mantenimiento.

### ÉPICA 3 — Catálogos (Admin)
**H3.1** CRUD Localizaciones  
- CA: crear/editar/activar/desactivar; disponibles en móvil.

**H3.2** CRUD Departamentos  
- CA: lista corta configurable; orden visible en móvil.

**H3.3** CRUD Equipos/Activos  
- CA: asociados a localización; filtrables al crear incidencia.

### ÉPICA 4 — Correctivos (Incidencias)
**H4.1** Crear incidencia (Flutter)  
- CA: crea ticket correcto; `assignedRole=mantenimiento`, `status=Abierta`; notifica mantenimiento.

**H4.2** Mis incidencias (Flutter)  
- CA: lista solo creadas por el usuario; filtros básicos; orden por defecto.

**H4.3** Cambio de prioridad por creador  
- CA: usuario cambia prioridad mientras no esté cerrada; genera evento `priority_changed`.

### ÉPICA 5 — Bandeja mantenimiento (Flutter)
**H5.1** Listado bandeja con filtros completos  
- CA: ve tickets de mantenimiento; filtros; orden por defecto; vistas guardadas.

**H5.2** Tomar incidencia y cambios de estado  
- CA: técnico toma (assignedTo=uid), cambia estado; eventos registrados.

**H5.3** En espera (motivo/detalle/ETA)  
- CA: obligatorio en espera; visible para todos; evento `waiting_set`.

### ÉPICA 6 — Documentación técnica
**H6.1** Partes de horas  
- CA: añadir/editar entradas; total horas calculado; evento `time_entry_added`.

**H6.2** Repuestos  
- CA: añadir/editar; evento `part_added`.

**H6.3** Fotos y evidencias  
- CA: subir a Storage; guardar url; evento `photo_added`.

### ÉPICA 7 — Cierre + Informe
**H7.1** Validación de cierre (reglas obligatorias)  
- CA: no cierra sin comentario+horas; preventivo requiere checklist completo.

**H7.2** Generación PDF en Cloud Functions  
- CA: PDF en Storage, url guardada; evento `report_generated`.

**H7.3** Envío de email con PDF adjunto  
- CA: email a creador+lead+admins; evento `email_sent`; fallback si falta email creador.

### ÉPICA 8 — Preventivos (plantillas + generación)
**H8.1** CRUD plantillas preventivas (Admin Web)  
- CA: crear/editar frecuencia X días + checklist por equipo; activar/desactivar.

**H8.2** Generador automático (scheduler)  
- CA: crea órdenes según reglas; evita duplicados; asigna dueAt; notifica mantenimiento.

**H8.3** Ejecución checklist en móvil  
- CA: OK/NOK/NA, nota/foto obligatoria según item; no permite cierre si incompleto.

### ÉPICA 9 — Incidencias global (Admin)
**H9.1** Listado global con todos los filtros  
- CA: filtros funcionan; export opcional (CSV futuro); acciones rápidas (asignar/prioridad).

### ÉPICA 10 — Calidad, auditoría y observabilidad
**H10.1** Timeline consistente en tickets (events)  
- CA: toda acción relevante crea event; timeline en PDF.

**H10.2** Logs y manejo de errores (Functions)  
- CA: logs claros; reintentos controlados; alertas si falla email/PDF.

---

## 14) Definition of Done (DoD)
Una historia se considera terminada cuando:
- Cumple criterios de aceptación.
- Tiene pruebas mínimas (unit o integración según capa).
- No rompe reglas de seguridad.
- Eventos/timeline quedan consistentes.
- UI: estados vacíos, errores y carga gestionados.
- Documentación actualizada (README + docs).

---

## 15) Riesgos y mitigaciones
- **Contadores displayId:** usar transacciones/Functions para consistencia.
- **PDF pesado:** limitar miniaturas; enlazar fotos si son muchas.
- **Spam de emails:** asegurar “solo al cerrar” y registrar `emailSentAt`.
- **Duplicados preventivos:** `oneActiveInstance=true` y checks por plantilla.
- **Reglas Firestore complejas:** testear rules con emuladores antes de producción.

---

## 16) Futuras mejoras (fase 2/3)
- SLA y métricas (MTTR, backlog por localización).
- Inventario real de repuestos y costes.
- Firma de conformidad.
- Integración con ERP / IoT (alarmas automáticas).
- Exportación avanzada (PDF lote, Excel/CSV).
- Roles por localización (si en el futuro se necesita compartir tickets por tienda).

---

## 17) Anexos
### 17.1 Plantilla email y estructura PDF
(Se implementan como plantillas configurables en Admin; usar variables estandarizadas.)

### 17.2 Rules base
Pegar las rules base definidas previamente y ajustar a `role`/`isMaintenanceLead`.

---

**Fin del documento**
