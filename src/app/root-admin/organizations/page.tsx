"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { MoreHorizontal, RotateCcw, ShieldOff, Trash2, Download, Broom, Trash } from "lucide-react";
import type { FieldValue, Timestamp } from "firebase/firestore";
import { RootAdminShell } from "@/components/root-admin/root-admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRootOrganizations } from "@/lib/root-admin/use-root-organizations";
import {
  markHardDeletedOrganization,
  restoreOrganization,
  softDeleteOrganization,
  suspendOrganization,
  purgeOrganizationData,
  exportOrganizationSnapshot,
} from "@/lib/root-admin/firestore";
import { useToast } from "@/hooks/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useFirestore } from "@/lib/firebase/provider";
import { useUser } from "@/lib/firebase";
import type { RootOrganization } from "@/lib/root-admin/types";
import { Icons } from "@/components/icons";

export default function RootOrganizationsPage() {
  const { data: organizations, loading } = useRootOrganizations();
  const [search, setSearch] = useState("");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return organizations;
    return organizations.filter((org) =>
      [org.name, org.ownerEmail, org.taxId]
        .filter(Boolean)
        .some((field) => field?.toLowerCase().includes(query)),
    );
  }, [organizations, search]);

  const actor = useMemo(
    () =>
      user
        ? {
            id: user.uid,
            email: user.email,
            name: user.displayName,
          }
        : null,
    [user],
  );

  const handleAction = async (
    org: RootOrganization,
    action: "suspend" | "restore" | "softDelete" | "hardDelete" | "purge" | "export",
  ) => {
    if (!firestore || !actor) return;
    setProcessingId(org.id);

    try {
      if (action === "suspend") {
        await suspendOrganization({ firestore, actor }, org.id, {
          reason: "Suspensión manual desde consola root",
        });
        toast({ title: "Organización suspendida", description: org.name });
      }

      if (action === "restore") {
        await restoreOrganization({ firestore, actor }, org.id, {
          reason: "Reactivación manual desde consola root",
        });
        toast({ title: "Organización reactivada", description: org.name });
      }

      if (action === "softDelete") {
        await softDeleteOrganization({ firestore, actor }, org.id, {
          reason: "Soft delete manual (cuarentena)",
        });
        toast({ title: "Soft delete aplicado", description: org.name });
      }

      if (action === "hardDelete") {
        await markHardDeletedOrganization({ firestore, actor }, org.id, {
          reason: "Marcada como eliminación definitiva",
        });
        toast({
          title: "Marcada para eliminación total",
          description: "Programa una purga con Cloud Scheduler.",
        });
      }

      if (action === "purge") {
        const results = await purgeOrganizationData(
          { firestore, actor },
          org.id,
          ["users", "memberships", "tasks", "incidents", "tickets", "assets", "departments"],
        );
        toast({
          title: "Purgado en progreso",
          description: `Eliminados: ${Object.entries(results)
            .map(([k, v]) => `${k}:${v}`)
            .join(" ")}`,
        });
      }

      if (action === "export") {
        const data = await exportOrganizationSnapshot(
          { firestore, actor },
          org.id,
          ["users", "memberships", "tasks", "incidents", "tickets", "assets", "departments"],
        );
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `org-${org.id}-export.json`;
        link.click();
        URL.revokeObjectURL(url);
        toast({ title: "Export listo", description: "Descarga iniciada" });
      }
    } catch (err) {
      console.error(err);
      toast({
        title: "No se pudo ejecutar la acción",
        description: err instanceof Error ? err.message : "Error desconocido",
        variant: "destructive",
      });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <RootAdminShell
      title="Organizaciones"
      description="Control de ciclo de vida, suspensión y eliminación de tenants."
    >
      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>Listado global</CardTitle>
            <p className="text-sm text-muted-foreground">
              Busca por nombre, email de propietario o RUT/CIF.
            </p>
          </div>
          <Input
            placeholder="Buscar organizaciones..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full max-w-sm"
          />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organización</TableHead>
                <TableHead>Propietario</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Usuarios</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Creada</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <div className="h-10 animate-pulse rounded-md bg-muted" />
                  </TableCell>
                </TableRow>
              )}
              {!loading && filtered.map((org) => (
                <TableRow key={org.id}>
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span>{org.name}</span>
                      <span className="text-xs text-muted-foreground">{org.id}</span>
                    </div>
                  </TableCell>
                  <TableCell>{org.ownerEmail ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {org.subscriptionPlan ?? "sin plan"}
                    </Badge>
                  </TableCell>
                  <TableCell>{org.userCount ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(org.status)}>
                      {statusLabel(org.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(org.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => handleAction(org, "suspend")}
                        disabled={processingId === org.id}
                      >
                        <ShieldOff className="mr-2 h-4 w-4" />
                        Suspender
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleAction(org, "restore")}
                        disabled={processingId === org.id}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Reactivar
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleAction(org, "softDelete")}
                        disabled={processingId === org.id}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Soft delete
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleAction(org, "hardDelete")}
                        disabled={processingId === org.id}
                      >
                        <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                        Marcar para eliminación total
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleAction(org, "purge")}
                        disabled={processingId === org.id}
                      >
                        <Broom className="mr-2 h-4 w-4" />
                        Purgar datos (en vivo)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleAction(org, "export")}
                        disabled={processingId === org.id}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Exportar JSON
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    No hay organizaciones que coincidan con la búsqueda.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </RootAdminShell>
  );
}

const statusLabel = (status: string) =>
  ({
    active: "Activa",
    suspended: "Suspendida",
    deleted_soft: "Soft delete",
    deleted_hard: "Hard delete",
  }[status] ?? status);

const statusVariant = (status: string) =>
  ({
    active: "secondary",
    suspended: "outline",
    deleted_soft: "destructive",
    deleted_hard: "destructive",
  }[status] as "secondary" | "outline" | "destructive" | undefined);

const formatDate = (value?: Timestamp | FieldValue | null) => {
  if (value && typeof (value as Timestamp).toDate === "function") {
    return format((value as Timestamp).toDate(), "PPP", { locale: es });
  }
  return "—";
};
