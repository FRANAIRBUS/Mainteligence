"use client";

import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { AlertCircle, CheckCircle2, PauseCircle, ShieldAlert, Database, FileDown } from "lucide-react";
import type { FieldValue, Timestamp } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RootAdminShell } from "@/components/root-admin/root-admin-shell";
import { useRootOrganizations } from "@/lib/root-admin/use-root-organizations";
import { useRootAuditLog } from "@/lib/root-admin/use-root-audit-log";
import type { AuditLogEntry } from "@/lib/root-admin/types";
import { cn } from "@/lib/utils";
import { CardDescription } from "@/components/ui/card";

export default function RootAdminHomePage() {
  const { data: organizations, loading: orgsLoading } = useRootOrganizations();
  const { data: auditLogs, loading: auditLoading } = useRootAuditLog(10);

  const active = organizations.filter((org) => org.status === "active").length;
  const suspended = organizations.filter((org) => org.status === "suspended").length;
  const deleted = organizations.filter((org) => org.status === "deleted_soft").length;

  return (
    <RootAdminShell
      title="Consola Root"
      description="Control centralizado de organizaciones, auditoría y acciones sensibles."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          title="Activas"
          value={active}
          loading={orgsLoading}
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-500" />}
          badge="Operativas"
        />
        <SummaryCard
          title="Suspendidas"
          value={suspended}
          loading={orgsLoading}
          icon={<PauseCircle className="h-5 w-5 text-amber-500" />}
          badge="Acceso bloqueado"
        />
        <SummaryCard
          title="Eliminadas (soft)"
          value={deleted}
          loading={orgsLoading}
          icon={<AlertCircle className="h-5 w-5 text-red-500" />}
          badge="En cuarentena"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>Organizaciones recientes</CardTitle>
            <CardDescription>Alta/baja y estado de onboarding a la vista.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {orgsLoading && <SkeletonRow />}
            {!orgsLoading && organizations.slice(0, 5).map((org) => (
              <div
                key={org.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div>
                  <p className="font-medium">{org.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Creada hace{" "}
                    {formatDistanceToNowSafe(org.createdAt)}
                  </p>
                </div>
                <Badge variant={statusVariant(org.status)}>
                  {statusLabel(org.status)}
                </Badge>
              </div>
            ))}
            {!orgsLoading && organizations.length === 0 && (
              <p className="text-sm text-muted-foreground">No hay organizaciones registradas.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-1">
            <CardTitle>Últimas acciones</CardTitle>
            <CardDescription>Auditoría de alto riesgo y cambios root.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {auditLoading && <SkeletonRow />}
            {!auditLoading && auditLogs.map((entry) => (
              <AuditRow key={entry.id} entry={entry} />
            ))}
            {!auditLoading && auditLogs.length === 0 && (
              <p className="text-sm text-muted-foreground">Sin registros recientes.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
              Flujo recomendado: suspensión → soft delete → purga
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>1) Suspende para bloquear accesos de inmediato.</p>
            <p>2) Aplica soft delete para marcar cuarentena (reversible).</p>
            <p>3) Marca hard delete y ejecuta purga para limpiar Firestore y Storage.</p>
            <p className="text-xs text-primary">Tip: usa export antes de purgar para respaldar.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Database className="h-5 w-5 text-primary" />
              Export y respaldo rápido
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Desde Organizaciones → menú, dispara <strong>Exportar JSON</strong> para obtener un snapshot por tenant.</p>
            <p>Guarda el JSON en tu bucket o descarga local antes de purgar.</p>
            <p className="flex items-center gap-2 text-xs">
              <FileDown className="h-4 w-4" /> Export incluye users, memberships, tasks, incidents, tickets, assets, departments.
            </p>
          </CardContent>
        </Card>
      </div>
    </RootAdminShell>
  );
}

function SummaryCard({
  title,
  value,
  loading,
  icon,
  badge,
}: {
  title: string;
  value: number;
  loading: boolean;
  icon: React.ReactNode;
  badge: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Badge variant="secondary">{badge}</Badge>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        <div className="rounded-lg bg-muted p-3">{icon}</div>
        {loading ? (
          <div className="h-6 w-12 animate-pulse rounded-md bg-muted" />
        ) : (
          <div className="text-3xl font-bold">{value}</div>
        )}
      </CardContent>
    </Card>
  );
}

function AuditRow({ entry }: { entry: AuditLogEntry }) {
  return (
    <div className="space-y-1 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant={entry.status === "success" ? "secondary" : "destructive"}>
            {entry.status === "success" ? "OK" : "Error"}
          </Badge>
          <p className="font-medium">{entry.action}</p>
        </div>
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNowSafe(entry.createdAt)}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        {entry.message ?? "Sin detalle adicional"}
      </p>
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="text-xs">
          {entry.targetType}:{entry.targetId}
        </Badge>
        {entry.actorEmail && (
          <Badge variant="outline" className="text-xs">
            Actor: {entry.actorEmail}
          </Badge>
        )}
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="space-y-2">
      <div className="h-12 w-full animate-pulse rounded-lg bg-muted" />
      <div className="h-12 w-full animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

const formatDistanceToNowSafe = (value?: Timestamp | FieldValue | null) => {
  if (value && typeof (value as Timestamp).toDate === "function") {
    return formatDistanceToNow((value as Timestamp).toDate(), { locale: es, addSuffix: true });
  }
  return "fecha desconocida";
};

const statusLabel = (status: string) =>
  ({
    active: "Activa",
    suspended: "Suspendida",
    deleted_soft: "Eliminada",
    deleted_hard: "Eliminada (hard)",
  }[status] ?? status);

const statusVariant = (status: string) =>
  ({
    active: "secondary",
    suspended: "outline",
    deleted_soft: "destructive",
    deleted_hard: "destructive",
  }[status] as "secondary" | "outline" | "destructive" | undefined);
