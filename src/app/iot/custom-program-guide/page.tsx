import Link from 'next/link';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const commands = [
  { title: 'Legacy (compatibles)', lines: [
    'SET RELn ON|OFF',
    'BLINK RELn onMs [offMs]',
    'TIMER RELn onMs offMs',
    'ONBOOT RELn delayMs onMs',
    'ONCHANGE INn TOGGLE RELm',
    'PULSE INn RELm onMs count [gapMs]',
    'THERMOSTAT RELn TEMPm setpoint diff [AUTO|COOL|HEAT]',
    'IF TEMPn op valor THEN RELm ON|OFF',
    'IF HUMn op valor THEN RELm ON|OFF',
    'IF INn op ON|OFF THEN RELm ON|OFF',
    'IFALL src1 op v1 src2 op v2 THEN RELm ON|OFF',
    'IFANY src1 op v1 src2 op v2 THEN RELm ON|OFF',
  ]},
  { title: 'Secuencia PROGRAM (visual)', lines: [
    'PROGRAM NAME=...',
    'START IN=INn | START VIN=VINn',
    'SET REL=RELn STATE=ON|OFF',
    'STEP REL=RELn STATE=ON|OFF [TIME=ms]',
    'WAIT TIME=ms',
    'WAITUNTIL TEMP=TEMPn OP=<= VALUE=10.0 STABLE=60000 MAX=3600000',
    'LOOP MAX=n UNTIL=TEMP1<=40.0 STABLE=30000',
    'ENDLOOP',
    'SAFETY IN=INn ACTION=ALL_OFF',
    'SAFETY VIN=VINn ACTION=ALL_OFF',
    'END',
  ]},
];

const onbootExample = [
  'ONBOOT REL1 10000 2000',
  'ONBOOT REL2 12000 2000',
  'ONBOOT REL3 14000 2000',
].join('\n');

const visualStepExample = [
  'PROGRAM NAME=VIN_QUICK',
  'START VIN=VIN1',
  'STEP REL=REL1 STATE=ON TIME=5000',
  'WAIT TIME=1000',
  'STEP REL=REL1 STATE=OFF',
  'END',
].join('\n');

const marmitaExample = [
  'PROGRAM NAME=MARMITA_COOL',
  'START IN=IN1',
  '',
  'SET REL=REL1 STATE=OFF',
  'SET REL=REL2 STATE=OFF',
  'SET REL=REL3 STATE=OFF',
  'SET REL=REL4 STATE=OFF',
  '',
  'LOOP MAX=8 UNTIL=TEMP1<=40.0 STABLE=30000',
  'STEP REL=REL1 STATE=ON TIME=30000',
  'STEP REL=REL2 STATE=ON TIME=45000',
  'WAIT TIME=300000',
  'ENDLOOP',
  '',
  'STEP REL=REL3 STATE=ON',
  'STEP REL=REL4 STATE=ON',
  'WAITUNTIL TEMP=TEMP1 OP=<= VALUE=10.0 STABLE=60000 MAX=3600000',
  'STEP REL=REL3 STATE=OFF',
  'STEP REL=REL4 STATE=OFF',
  '',
  'SAFETY IN=IN4 ACTION=ALL_OFF',
  'END',
].join('\n');

export default function IotCustomProgramGuidePage() {
  return (
    <AppShell
      title="Guia Cloud de Custom Program"
      description="Referencia completa para programar dispositivos IoT desde Mainteligence sin perder compatibilidad legacy."
      action={
        <Button asChild>
          <Link href="/iot">Volver a IoT</Link>
        </Button>
      }
    >
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Objetivo</CardTitle>
            <CardDescription>
              Mantener comandos legacy y habilitar secuencias visuales tipo PROGRAM, con control remoto por VIN desde desiredState.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="font-semibold text-foreground">Cloud recomendado</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>`desiredState.customProgram` para cargar/actualizar el script.</li>
                <li>`desiredState.pulseVirtualInput` para disparar VIN sin estado mantenido.</li>
                <li>`reportedState` para observar validacion y estado de secuencia.</li>
              </ul>
            </div>
            <div className="rounded-lg border p-3">
              <p className="font-semibold text-foreground">Campos relevantes en reportedState</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>`customProgramValid`, `customProgramMode`, `customProgramError`</li>
                <li>`sequenceRunning`, `sequenceState`, `sequenceCurrentStep`, `sequenceCurrentLoop`</li>
                <li>`sequenceError`, `sequenceUsedRelays`, `sequenceReservedRelays`, `virtualInputs`</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          {commands.map((section) => (
            <Card key={section.title}>
              <CardHeader>
                <CardTitle>{section.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-6">{section.lines.join('\n')}</pre>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Ejemplos listos para copiar</CardTitle>
            <CardDescription>
              Incluye el ONBOOT que faltaba y referencias visuales tipo STEP.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-semibold">ONBOOT escalonado</p>
              <pre className="overflow-auto rounded-md bg-muted/40 p-3 text-xs leading-6">{onbootExample}</pre>
            </div>
            <div className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-semibold">Secuencia visual minima</p>
              <pre className="overflow-auto rounded-md bg-muted/40 p-3 text-xs leading-6">{visualStepExample}</pre>
            </div>
            <div className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-semibold">Marmita por fases</p>
              <pre className="max-h-72 overflow-auto rounded-md bg-muted/40 p-3 text-xs leading-6">{marmitaExample}</pre>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payloads cloud</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-semibold">Pulso VIN remoto</p>
              <pre className="overflow-auto rounded-md bg-muted/40 p-3 text-xs leading-6">{`{
  "desiredState": {
    "pulseVirtualInput": "VIN1"
  }
}`}</pre>
            </div>
            <div className="rounded-lg border p-3">
              <p className="mb-2 text-sm font-semibold">Cargar customProgram</p>
              <pre className="overflow-auto rounded-md bg-muted/40 p-3 text-xs leading-6">{`{
  "desiredState": {
    "workMode": 4,
    "customProgram": "PROGRAM NAME=VIN_QUICK\\nSTART VIN=VIN1\\nSTEP REL=REL1 STATE=ON TIME=5000\\nSTEP REL=REL1 STATE=OFF\\nEND"
  }
}`}</pre>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
