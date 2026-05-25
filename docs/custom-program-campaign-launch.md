# CustomProgram - Dossier Comercial para Campana y Lanzamiento

Fecha: 2026-05-25
Producto: Maintelligence IoT + Firmware industrial ESP32
Modulo protagonista: `customProgram` (reglas + secuencias por pasos)

## 1. Resumen Ejecutivo

`customProgram` convierte el controlador IoT en un sistema programable en campo sin depender de PLC externo para logicas de automatizacion recurrentes. El cliente puede:

- Programar reglas clasicas de control con sintaxis simple.
- Ejecutar secuencias por pasos tipo proceso industrial.
- Arrancar programas por entradas fisicas o virtuales.
- Operar y supervisar desde web local y desde cloud.
- Mantener seguridad operativa con parada de emergencia y prioridad de protecciones.

Mensaje comercial central:
"Menos integracion, menos tiempos de puesta en marcha, mas control operativo desde un unico entorno."

## 2. Problema que Resuelve

- Equipos con automatizaciones parciales que hoy dependen de intervencion manual.
- Clientes que no quieren sobrecoste y complejidad de PLC para casos medianos.
- Necesidad de arrancar procesos remotos desde cloud sin cableado adicional.
- Dificultad para validar rapidamente si una logica esta correcta antes de producir.

## 3. Propuesta de Valor

- Programacion operativa rapida con comandos legibles.
- Compatibilidad hacia atras con reglas existentes (sin romper instalaciones actuales).
- Nuevo modo visual por pasos para procesos reales (llenado, vaciado, enfriado, recirculacion, etc.).
- Entradas virtuales `VIN1..VIN4` para disparo remoto seguro por flanco.
- Diagnostico inmediato de parser y ejecucion en `/api/v1/state` y `reportedState`.

## 4. Que Puede Hacer (Capacidades Comercializables)

### 4.1 Modo Reglas (legacy, mantenido)

Comandos disponibles:

- `SET RELn ON|OFF`
- `BLINK RELn onMs [offMs]`
- `TIMER RELn onMs offMs`
- `ONBOOT RELn delayMs onMs`
- `ONCHANGE INn TOGGLE RELm`
- `PULSE INn RELm onMs count [gapMs]`
- `THERMOSTAT RELn TEMPm setpoint diff [AUTO|COOL|HEAT]`
- `IF ... THEN ...`
- `IFALL ... THEN ...`
- `IFANY ... THEN ...`

### 4.2 Modo Secuencia (nuevo bloque `PROGRAM`)

Permite procesos paso a paso:

- `PROGRAM NAME=...`
- `START IN=INn`
- `START VIN=VINn`
- `SET REL=... STATE=...`
- `STEP REL=... STATE=... TIME=...`
- `WAIT TIME=...`
- `WAITUNTIL TEMP=... OP=... VALUE=... STABLE=... MAX=...`
- `LOOP ... ENDLOOP`
- `SAFETY IN=... ACTION=ALL_OFF`
- `SAFETY VIN=... ACTION=ALL_OFF`
- `END`

Punto clave comercial:
- Se puede definir mas de una linea `START` y el arranque funciona como OR por flanco (ejemplo: `START IN=IN1` y `START VIN=VIN1`).
- No se hace reinicio continuo por entrada mantenida en ON.

### 4.3 Entradas virtuales para operacion remota

- `VIN1..VIN4` visibles en estado.
- Pulso remoto:
  - Local API: `POST /api/v1/control` con `{ "pulseVirtualInput": "VIN1" }`
  - Cloud: `desiredState.pulseVirtualInput`
- Botones directos en UI para `Pulsar VIN1..VIN4`.

### 4.4 Seguridad y prioridad operacional

- `SAFETY ... ACTION=ALL_OFF` detiene secuencia y apaga salidas.
- Durante secuencia activa, los reles de secuencia quedan reservados.
- Prioridad efectiva:
  - Seguridad
  - Secuencia activa
  - Reglas normales
  - Manual/cloud (segun modo)

### 4.5 Observabilidad para soporte y ventas tecnicas

- Estado local: `/api/v1/state`
- Estado cloud: `reportedState`
- Campos clave:
  - `customProgramValid`, `customProgramMode`, `customProgramError`
  - `sequenceRunning`, `sequenceState`, `sequenceCurrentStep`, `sequenceCurrentLoop`
  - `sequenceError`, `sequenceUsedRelays`, `sequenceReservedRelays`
  - `virtualInputs`

## 5. Limites Tecnicos (mensajes claros para preventa)

- Maximo 1 `PROGRAM` por script.
- Maximo 32 lineas dentro del `PROGRAM`.
- Maximo 24 pasos ejecutables.
- Maximo 1 `LOOP` (sin anidado).
- Tiempos entre 50 ms y 86400000 ms.
- `customProgram` en configuracion: 640 caracteres.
- Sin expresiones matematicas libres ni `ELSE`.

Mensaje recomendado:
"Potente para automatizacion de campo, acotado para mantener seguridad, trazabilidad y soporte."

## 6. Casos de Uso para Campana

- Industria alimentaria: enfriamiento de marmita por fases con validacion por temperatura estable.
- HVAC tecnico: arranques por etapas y bloqueo por seguridad.
- Riego industrial: pulsos, ventanas de tiempo y parada por sensor.
- Bombeo y recirculacion: ciclos con limite maximo y condicion de salida estable.
- Retrofit en maquinaria existente: agrega control remoto con VIN sin recableado extra para arranque logico.

## 7. Ejemplos Comerciales Listos

### 7.1 ONBOOT escalonado

```txt
ONBOOT REL1 10000 2000
ONBOOT REL2 12000 2000
ONBOOT REL3 14000 2000
```

### 7.2 Secuencia visual corta

```txt
PROGRAM NAME=VIN_QUICK
START IN=IN1
START VIN=VIN1
STEP REL=REL1 STATE=ON TIME=5000
STEP REL=REL1 STATE=OFF
END
```

### 7.3 Marmita por fases (mensaje flagship)

```txt
PROGRAM NAME=MARMITA_COOL
START IN=IN1

SET REL=REL1 STATE=OFF
SET REL=REL2 STATE=OFF
SET REL=REL3 STATE=OFF
SET REL=REL4 STATE=OFF

LOOP MAX=8 UNTIL=TEMP1<=40.0 STABLE=30000
STEP REL=REL1 STATE=ON TIME=30000
STEP REL=REL2 STATE=ON TIME=45000
WAIT TIME=300000
ENDLOOP

STEP REL=REL3 STATE=ON
STEP REL=REL4 STATE=ON
WAITUNTIL TEMP=TEMP1 OP=<= VALUE=10.0 STABLE=60000 MAX=3600000
STEP REL=REL3 STATE=OFF
STEP REL=REL4 STATE=OFF

SAFETY IN=IN4 ACTION=ALL_OFF
END
```

## 8. Cambios en Plataforma (Maintelligence App + Web Local)

- Editor de `customProgram` conservado.
- Guia independiente en espanol para comandos y funcionamiento.
- Plantillas/carga rapida de ejemplos.
- Diagnostico visible de validez y estado de secuencia.
- Botones de pulso para VIN en panel operativo.
- Soporte cloud para:
  - `desiredState.customProgram`
  - `desiredState.pulseVirtualInput`
  - `desiredState.virtualInputs` (opcional para control explicito)

## 9. Mensajeria para Marketing

### 9.1 Mensajes principales

- "Automatiza procesos sin PLC adicional para casos medianos."
- "Programa en lenguaje operativo legible por mantenimiento."
- "Dispara procesos desde campo o cloud con seguridad priorizada."
- "Valida, depura y audita con estado en tiempo real."

### 9.2 Elevator pitch (30 segundos)

"Maintelligence CustomProgram combina reglas clasicas y secuencias industriales por pasos en el propio ESP32. El equipo puede arrancar por entradas fisicas o virtuales desde cloud, ejecutar logica no bloqueante con seguridad prioritaria y reportar estado detallado para operacion y soporte. Resultado: menos tiempo de puesta en marcha y mas autonomia de planta."

### 9.3 Claim de lanzamiento

"De la idea al proceso automatizado, en minutos y sin complejidad innecesaria."

## 10. Plan de Lanzamiento (Go-To-Market)

### Fase 1 - Prelanzamiento (7-14 dias)

- Publicar teaser tecnico-comercial (video corto + caso marmita).
- Entrenamiento a ventas y soporte con demo guiada.
- Crear lista de 10 cuentas objetivo para piloto.

### Fase 2 - Lanzamiento (Semana 0)

- Publicacion de landing y nota de version.
- Webinar demo en vivo (30 min) con Q&A.
- Activacion de campaña en LinkedIn/email a base instalada.

### Fase 3 - Postlanzamiento (30 dias)

- Seguimiento de pilotos y casos de exito.
- Paquete de testimonios con KPI de ahorro/tiempo.
- Iteracion de mensajes segun objeciones reales.

## 11. KPI de Campana

- Numero de dispositivos con `workMode=custom`.
- Ratio de scripts validos (`customProgramValid=true`).
- Numero de secuencias ejecutadas por semana.
- Tiempo medio de puesta en marcha por cliente.
- Conversion de pilotos a despliegue.
- Reduccion de incidencias por error de logica.

## 12. FAQ Comercial (para ventas y partners)

- "Es compatible con lo ya instalado?"
  - Si. Se mantiene compatibilidad con comandos legacy.

- "Se puede arrancar remoto sin entrada fisica?"
  - Si, con `VIN1..VIN4` y `pulseVirtualInput`.

- "Y la seguridad?"
  - La parada fisica sigue siendo la referencia principal. La seguridad virtual es complemento.

- "Se puede saber por que no corre un programa?"
  - Si. Parser y runtime reportan error y linea.

- "Se puede mezclar reglas y secuencia?"
  - Si, en modo mixto, manteniendo reserva de reles de secuencia durante ejecucion.

## 13. Argumentario de Cierre

- Menos CAPEX y menos dependencia de integracion externa.
- Mas velocidad para pasar de prueba a produccion.
- Mejor control remoto y trazabilidad operacional.
- Base tecnica escalable para futuros asistentes de programacion guiada.

## 14. Siguiente Paso Comercial Recomendado

- Lanzar un piloto corto de 2 semanas con el caso marmita como referencia.
- Medir 3 KPI: tiempo de configuracion, estabilidad de proceso, intervenciones manuales evitadas.
- Convertir el resultado en caso publico de adopcion para abrir vertical industrial.
