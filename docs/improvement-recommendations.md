# Plan de mejora frente a la especificación premium GMAO

## Observaciones del estado actual
- **Registro básico de incidencias**: el diálogo actual permite crear tickets con título, descripción, ubicación, departamento, activo opcional, prioridad y fotos. Asigna `status="Abierta"`, `assignedRole="mantenimiento"` y genera un `displayId` temporal, pero no gestiona checklist, validaciones de cierre ni contadores transaccionales.【F:src/app/add-incident-dialog.tsx†L44-L219】
- **Visibilidad y filtros limitados**: la vista de incidencias usa una única tabla sin filtros avanzados y permite a operarios ver tickets por departamento y asignados, además de los creados por ellos. Esta visibilidad ampliada se mantendrá de forma controlada según lo solicitado.【F:src/app/incidents/page.tsx†L48-L270】
- **Ausencia de flujos preventivos y auditoría**: no existen pantallas ni modelos para plantillas preventivas, generación automática, timeline de eventos, partes de horas, repuestos, checklist instanciados, PDF/email de cierre o notificaciones push.

## Ajustes aplicados en esta iteración
- **Endurecimiento de reglas de Firestore**: la lectura de tickets ahora se alinea con la visibilidad de la UI (mantenimiento ve todo; operarios solo los creados por ellos, asignados o de su departamento). Solo se permiten creaciones si `createdBy` coincide con el usuario autenticado.【F:firestore.rules†L8-L67】
- **Control de acceso en Storage**: las fotos de tickets y la subida del logo corporativo ahora exigen que el usuario tenga permiso sobre el ticket o rol de administrador para el logo. Se evita que usuarios autenticados escriban en tickets ajenos.【F:storage.rules†L1-L53】

## Recomendaciones priorizadas
1. **Mantener visibilidad ampliada con controles claros**
   - Conservar que el operario pueda ver incidencias creadas por él, las de su departamento y las que tenga asignadas, pero reflejar en la UI qué acciones están permitidas (solo mantenimiento cambia estado/asignaciones, operario solo cambia prioridad).【F:src/app/incidents/page.tsx†L171-L188】
   - Señalizar en la documentación y en las futuras reglas de seguridad que esta visibilidad es una excepción consciente al principio de permisos mínimos de la especificación, para revisarlo más adelante si se requiere endurecer.

2. **Modelo de datos completo y contadores**
   - Incorporar los campos obligatorios de tickets (waiting, closedAt, reportPdfUrl, checklist preventivo, etc.) y colecciones anidadas (`comments`, `events`, `timeEntries`, `parts`) para asegurar trazabilidad.【F:docs/SPEC_GMAO.md†L214-L282】
   - Reemplazar el `displayId` temporal por contadores anuales transaccionales (`INC-{YYYY}-{NNNN}` / `PREV-{SITE}-{ASSET}-{YYYY}-{NNN}`) mediante Cloud Functions o transacciones en `counters/{orgId}/years/{YYYY}`.【F:src/app/add-incident-dialog.tsx†L104-L129】【F:docs/SPEC_GMAO.md†L276-L282】【F:docs/SPEC_GMAO.md†L506-L510】

3. **Ciclo de vida y cierre con validaciones**
   - Implementar los estados oficiales (Abierta → En curso → En espera → Resuelta → Cerrada) y exigir motivo/detalle/ETA en “En espera”.【F:docs/SPEC_GMAO.md†L69-L80】
   - Bloquear el cierre sin comentario técnico, partes de horas y checklist completo en preventivos; registrar eventos `status_changed`, `time_entry_added`, `part_added`, `closed` y `report_generated` para timeline y PDF.【F:docs/SPEC_GMAO.md†L81-L90】【F:docs/SPEC_GMAO.md†L250-L260】【F:docs/SPEC_GMAO.md†L452-L470】

4. **Preventivos y checklists**
   - Añadir CRUD de plantillas preventivas con `frequencyDays`, `overdueEscalation` y `checklistItems`; generar órdenes automáticas con `oneActiveInstance=true` y notificación FCM al equipo de mantenimiento.【F:docs/SPEC_GMAO.md†L268-L282】【F:docs/SPEC_GMAO.md†L319-L480】【F:docs/SPEC_GMAO.md†L25-L32】【F:docs/SPEC_GMAO.md†L319-L342】
   - En la app móvil/web, construir ejecución de checklist instanciado (OK/NOK/NA, nota/foto obligatoria) y bloqueo de cierre si hay pendientes.【F:docs/SPEC_GMAO.md†L237-L245】【F:docs/SPEC_GMAO.md†L472-L480】

5. **Panel admin y filtros avanzados**
   - Completar las secciones de configuración (localizaciones, departamentos, activos, usuarios/roles, plantillas preventivas, plantillas de informe) y un listado global con todos los filtros descritos para admin/mantenimiento, más vistas guardadas clave (Críticas, En espera, Vencidas, etc.).【F:docs/SPEC_GMAO.md†L121-L132】【F:docs/SPEC_GMAO.md†L285-L316】【F:docs/SPEC_GMAO.md†L482-L489】

6. **Notificaciones, PDF y email de cierre**
   - Preparar Functions para generar PDF de cierre, guardar `reportPdfUrl`, y enviar email a creador + responsable mantenimiento + admins; registrar `email_sent` en timeline.【F:docs/SPEC_GMAO.md†L31-L33】【F:docs/SPEC_GMAO.md†L88-L90】【F:docs/SPEC_GMAO.md†L466-L471】
   - Gestionar tokens FCM por dispositivo y disparar notificaciones en creación de correctivos y órdenes preventivas nuevas.【F:docs/SPEC_GMAO.md†L25-L32】【F:docs/SPEC_GMAO.md†L319-L342】【F:docs/SPEC_GMAO.md†L9-L21】

7. **Seguridad y calidad**
   - Endurecer reglas de Firestore/Storage para reflejar la visibilidad definida (incluida la excepción de operarios) y subir evidencias solo a tickets accesibles; probarlas con emuladores.【F:docs/SPEC_GMAO.md†L64-L90】【F:docs/SPEC_GMAO.md†L372-L383】
   - Añadir logs y manejo de errores en Functions para PDF/email, siguiendo los riesgos identificados (contadores, spam de emails, duplicados de preventivos).【F:docs/SPEC_GMAO.md†L506-L512】【F:docs/SPEC_GMAO.md†L486-L491】

## Próximos pasos sugeridos
1. Documentar y aplicar la visibilidad ampliada de operarios en consultas y rules, manteniendo controles de acción por rol en UI.
2. Extender el modelo de Firestore y las pantallas de tickets con timeline, partes, repuestos y cierres validados.
3. Desarrollar preventivos (plantillas + generador + checklist de ejecución) y notificaciones push.
4. Incorporar generación de PDF/email de cierre y plantillas configurables desde el admin.
5. Completar filtros avanzados y vistas guardadas en el panel admin.
