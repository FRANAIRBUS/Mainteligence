# Guía rápida para modo multi-organización

Este documento resume las buenas prácticas para el onboarding multi‑organización en aplicaciones B2B como Mainteligence.

## 1) Primer administrador y bootstrap de organización
- **Detección automática**: Si el usuario inicia sesión y su UID no tiene perfil en Firestore, muestra un flujo guiado. Explica que se va a crear su perfil y la organización.
- **Aviso explícito**: Informa que se creará una nueva organización y que el usuario será el administrador principal (`role: super_admin`, `active: true`).
- **Confirmación en dos pasos**: (a) revisión de los datos de la organización, (b) creación del perfil admin. Esto reduce altas accidentales.

## 2) Comprobación de existencia de organización
- **Lookup previo**: antes de crear, busca la organización por `organizationId` o por un identificador amigable (p. ej. CIF/NIF o dominio). Si existe, muestra su nombre fiscal y pide confirmación para unirse.
- **Solicitudes de admin**: si el usuario quiere ser admin en una organización ya existente, genera una solicitud que debe aprobar un admin actual; evita que cualquiera se autoproclame admin.

## 3) Formulario de datos de organización
- **Campos recomendados**: nombre fiscal, NIF/CIF, país, dirección, email de facturación, teléfono de contacto y tamaño de plantilla (para estimar límites iniciales).
- **Opcionales pero útiles**: razón social abreviada, dominio corporativo, sector y horario de soporte.
- **Privacidad**: permite alta “rápida” con mínimos campos obligatorios (nombre fiscal y país) y deja el resto como opcional para no bloquear el onboarding. Pide verificación antes de activar facturación.

## 4) Pertenencia a múltiples organizaciones
- **Modelo recomendado**: tabla de membresías (`memberships`) con `userId`, `organizationId`, rol y estado. Permite que el mismo UID pertenezca a varias organizaciones y cambiar de organización con un selector en la UI.
- **Compatibilidad legacy**: si aún existe `users/{uid}.organizationId`, úsalo como respaldo temporal mientras completas la migración a membresías.

## 5) Menú y cambio de organización
- Muestra la organización activa junto al nombre del usuario.
- Si soportas multi‑membresía, ofrece un selector de organización que actualice el `organizationId` de la sesión (o la membresía activa) y vuelva a cargar los datos filtrados.

## 6) Facturación y límites por módulo
- Define desde el inicio métricas de facturación: número de usuarios activos, tareas/incidencias creadas al mes, equipos registrados, almacenamiento de adjuntos.
- Aplica **soft limits** con avisos cuando se acerca el umbral y **hard stops** opcionales que bloqueen creación de nuevos elementos al superar el plan.
- Registra el consumo por organización para permitir upgrades automáticos o avisos de renovación.

## 7) Estados de organización y acceso
- Mantén un `status` por organización (`active`, `suspended`, `deleted`) y un flag derivado `isActive` para compatibilidad.
- Bloquea lectura/escritura cuando el estado no sea `active` para evitar acceso a datos de organizaciones cerradas.
- Registra en auditoría quién y cuándo cambia el estado.

## 8) UX recomendada en la página de registro
1. Paso 1: email/contraseña y `organizationId` deseado.
2. Paso 2: lookup de organización. Si existe, muestra ficha y permite solicitar alta o admin. Si no existe, avisa que se creará una nueva organización y que el usuario será el primer administrador.
3. Paso 3: formulario breve de datos de organización (mínimos obligatorios + opcionales). 
4. Paso 4: confirmación y creación de perfil admin.

Esta secuencia evita confusión, captura los datos necesarios para facturación futura y deja abierta la posibilidad de multi‑membresía cuando el producto lo requiera.
