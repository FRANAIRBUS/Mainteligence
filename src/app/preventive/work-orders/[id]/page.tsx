"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { doc, orderBy, serverTimestamp, updateDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icons } from "@/components/icons";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

import { useCollectionQuery, useDoc, useFirebaseApp, useFirestore, useUser } from "@/lib/firebase";
import type { WorkOrder, WorkOrderChecklistItem } from "@/lib/firebase/models";
import { orgDocPath, orgWorkOrderChecklistItemsPath } from "@/lib/organization";

type ReportEntry = {
  description?: string;
  createdBy?: string;
  createdAt?: any;
};

export default function WorkOrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const woId = Array.isArray(params.id) ? params.id[0] : (params.id as string | undefined);

  const app = useFirebaseApp();
  const firestore = useFirestore();
  const { toast } = useToast();

  const { user, loading: userLoading, organizationId } = useUser();

  const { data: workOrder, loading: workOrderLoading } = useDoc<WorkOrder>(
    woId && organizationId ? orgDocPath(organizationId, "workOrders", woId) : null
  );

  // IMPORTANT: memoize QueryConstraint objects to avoid re-subscribe loops.
  const checklistConstraints = useMemo(() => [orderBy("order", "asc")], []);

  const { data: checklistItems, loading: checklistLoading } = useCollectionQuery<WorkOrderChecklistItem>(
    woId && organizationId ? orgWorkOrderChecklistItemsPath(organizationId, woId) : null,
    ...checklistConstraints
  );

  const isLoading = userLoading || workOrderLoading;

  useEffect(() => {
    if (!userLoading && !user) {
      router.replace("/login");
    }
  }, [user, userLoading, router]);

  const statusLabel = useMemo(() => {
    const st = workOrder?.status ?? "open";
    if (st === "open") return "Abierta";
    if (st === "in_progress") return "En progreso";
    return "Cerrada";
  }, [workOrder?.status]);

  const canClose = workOrder?.isOpen === true;
  const [closing, setClosing] = useState(false);

  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [reportDescription, setReportDescription] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);

  const sortedReports = useMemo(() => {
    const reports = (workOrder as any)?.reports as ReportEntry[] | undefined;
    if (!reports || !Array.isArray(reports)) return [];
    return [...reports].sort((a, b) => {
      const aDate = a?.createdAt?.toDate?.() ?? a?.createdAt ?? null;
      const bDate = b?.createdAt?.toDate?.() ?? b?.createdAt ?? null;
      const aMs = aDate instanceof Date ? aDate.getTime() : 0;
      const bMs = bDate instanceof Date ? bDate.getTime() : 0;
      return bMs - aMs;
    });
  }, [workOrder]);

  const toggleChecklistItem = async (item: WorkOrderChecklistItem) => {
    if (!organizationId || !woId || !user || !firestore) return;

    try {
      const ref = doc(
        firestore,
        orgWorkOrderChecklistItemsPath(organizationId, woId),
        item.id
      );
      const nextDone = !Boolean(item.done);
      await updateDoc(ref, {
        done: nextDone,
        doneAt: nextDone ? serverTimestamp() : null,
        doneBy: nextDone ? user.uid : null,
        updatedAt: serverTimestamp(),
      });
    } catch (err: any) {
      console.error("toggleChecklistItem failed", err);
      toast({
        title: "No se pudo actualizar",
        description: err?.message ?? "Error inesperado",
        variant: "destructive",
      });
    }
  };

  const addWorkOrderReport = async () => {
    if (!app || !organizationId || !woId) return;
    if (!workOrder?.isOpen) {
      toast({
        title: "OT cerrada",
        description: "La OT está cerrada. No se pueden agregar más informes.",
        variant: "destructive",
      });
      return;
    }

    const description = reportDescription.trim();
    if (!description) {
      toast({
        title: "Agrega una descripción",
        description: "Describe el informe antes de enviarlo.",
        variant: "destructive",
      });
      return;
    }

    setReportSubmitting(true);
    try {
      const fn = httpsCallable(getFunctions(app), "workOrders_addReport");
      await fn({ organizationId, woId, description });
      setReportDescription("");
      setIsReportDialogOpen(false);
      toast({ title: "Informe agregado", description: "Se registró el seguimiento de la OT." });
    } catch (err: any) {
      console.error("workOrders_addReport failed", err);
      toast({
        title: "No se pudo guardar el informe",
        description: err?.message ?? "Vuelve a intentarlo en unos segundos.",
        variant: "destructive",
      });
    } finally {
      setReportSubmitting(false);
    }
  };

  const closeWorkOrder = async () => {
    if (!app || !organizationId || !woId) return;

    setClosing(true);
    try {
      const fn = httpsCallable(getFunctions(app), "workOrders_close");
      await fn({ organizationId, woId });
      toast({ title: "OT cerrada", description: "La OT se ha cerrado correctamente." });
    } catch (err: any) {
      console.error("workOrders_close failed", err);
      toast({
        title: "No se pudo cerrar",
        description: err?.message ?? "Error inesperado",
        variant: "destructive",
      });
    } finally {
      setClosing(false);
    }
  };

  return (
    <AppShell
      title="Detalle de OT"
      description="Mantenimiento preventivo"
      action={
        <Button variant="outline" onClick={() => router.back()}>
          Volver
        </Button>
      }
    >
      <div className="mb-4">
        <Button variant="outline" asChild>
          <Link href="/preventive">Volver a preventivos</Link>
        </Button>
      </div>
      {isLoading ? (
        <div className="flex h-64 w-full items-center justify-center">
          <Icons.spinner className="h-8 w-8 animate-spin" />
        </div>
      ) : !workOrder ? (
        <Card>
          <CardHeader>
            <CardTitle>OT no encontrada</CardTitle>
            <CardDescription>No existe o no tienes permisos.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-4">
                <span>{workOrder.title}</span>
                <Badge variant="outline">{statusLabel}</Badge>
              </CardTitle>
              {workOrder.description ? <CardDescription className="whitespace-pre-line">{workOrder.description}</CardDescription> : null}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Prioridad: {workOrder.priority ?? "Media"}</Badge>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setIsReportDialogOpen(true)} disabled={!workOrder.isOpen}>
                  Registrar informe
                </Button>
                <Button variant="destructive" onClick={closeWorkOrder} disabled={!canClose || closing}>
                  {closing ? <Icons.spinner className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Cerrar
                </Button>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Informes</h3>
                  <Button size="sm" variant="ghost" onClick={() => setIsReportDialogOpen(true)} disabled={!workOrder.isOpen}>
                    Añadir
                  </Button>
                </div>

                {sortedReports.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aún no hay informes para esta OT.</p>
                ) : (
                  <div className="space-y-2">
                    {sortedReports.map((report, index) => {
                      const date = report.createdAt?.toDate?.() ?? new Date();
                      const reporter = report.createdBy ?? "";
                      return (
                        <div key={`${index}-${reporter}`} className="rounded-md border p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>{date.toLocaleString()}</span>
                            {reporter ? <span className="font-mono">{reporter}</span> : null}
                          </div>
                          <p className="mt-2 whitespace-pre-line text-sm text-foreground">
                            {String(report.description ?? "")}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>Checklist</span>
                {workOrder.checklistRequired ? <Badge>Obligatorio</Badge> : <Badge variant="outline">Opcional</Badge>}
              </CardTitle>
              <CardDescription>
                Marca los items. Si es obligatorio, no se puede cerrar sin completar los requeridos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {checklistLoading ? (
                <div className="flex h-32 w-full items-center justify-center">
                  <Icons.spinner className="h-6 w-6 animate-spin" />
                </div>
              ) : checklistItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay checklist.</p>
              ) : (
                <div className="space-y-2">
                  {checklistItems.map((item) => (
                    <label key={item.id} className="flex items-start gap-2 rounded-md border p-2">
                      <input
                        type="checkbox"
                        checked={Boolean(item.done)}
                        onChange={() => toggleChecklistItem(item)}
                      />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{item.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.required ? "Requerido" : "Opcional"}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={isReportDialogOpen} onOpenChange={setIsReportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo informe</DialogTitle>
            <DialogDescription>
              Describe el informe o avance que deseas registrar para esta OT.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="workorder-report">Detalle del informe</Label>
            <Textarea
              id="workorder-report"
              placeholder="Describe el informe o avance que deseas registrar"
              value={reportDescription}
              onChange={(e) => setReportDescription(e.target.value)}
              disabled={reportSubmitting || !workOrder?.isOpen}
            />
            {!workOrder?.isOpen ? (
              <p className="text-xs text-muted-foreground">La OT está cerrada. No se pueden agregar más informes.</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsReportDialogOpen(false)} disabled={reportSubmitting}>
              Cancelar
            </Button>
            <Button onClick={addWorkOrderReport} disabled={reportSubmitting || !workOrder?.isOpen}>
              {reportSubmitting ? <Icons.spinner className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar informe
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
