"use client";

import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RootAdminShell } from "@/components/root-admin/root-admin-shell";
import { useRootAuditLog } from "@/lib/root-admin/use-root-audit-log";
import type { AuditLogEntry } from "@/lib/root-admin/types";
import type { FieldValue, Timestamp } from "firebase/firestore";

export default function RootAuditLogPage() {
  const { data: entries, loading } = useRootAuditLog(50);

  return (
    <RootAdminShell
      title="Bitácora de auditoría"
      description="Registro inmutable de acciones administrativas y root."
    >
      <Card>
        <CardHeader>
          <CardTitle>Eventos recientes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <Skeleton />}
          {!loading && entries.map((entry) => <AuditItem key={entry.id} entry={entry} />)}
          {!loading && entries.length === 0 && (
            <p className="text-sm text-muted-foreground">No hay entradas de auditoría.</p>
          )}
        </CardContent>
      </Card>
    </RootAdminShell>
  );
}

function AuditItem({ entry }: { entry: AuditLogEntry }) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={entry.status === "success" ? "secondary" : "destructive"}>
            {entry.status}
          </Badge>
          <p className="font-medium">{entry.action}</p>
        </div>
        <span className="text-xs text-muted-foreground">
          {formatDate(entry.createdAt)}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        {entry.message ?? "Sin mensaje"}
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
        {entry.actorName && (
          <Badge variant="outline" className="text-xs">
            Nombre: {entry.actorName}
          </Badge>
        )}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2">
      <div className="h-12 w-full animate-pulse rounded-lg bg-muted" />
      <div className="h-12 w-full animate-pulse rounded-lg bg-muted" />
      <div className="h-12 w-full animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

const formatDate = (value?: Timestamp | FieldValue | null) => {
  if (value && typeof (value as Timestamp).toDate === "function") {
    return format((value as Timestamp).toDate(), "PPPp", { locale: es });
  }
  return "Sin fecha";
};
