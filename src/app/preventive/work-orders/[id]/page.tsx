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
import { Icons } from "@/components/icons";
import { useToast } from "@/hooks/use-toast";

import { useCollectionQuery, useDoc, useFirebaseApp, useFirestore, useUser } from "@/lib/firebase";
import type { WorkOrder, WorkOrderChecklistItem } from "@/lib/firebase/models";
import { orgDocPath, orgWorkOrderChecklistItemsPath } from "@/lib/organization";

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

  const { data: checklistItems, loading: checklistLoading } = useCollectionQuery<WorkOrderChecklistItem>(
    woId && organizationId ? orgWorkOrderChecklistItemsPath(organizationId, woId) : null,
    orderBy("order", "asc")
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
    if (st === "in_progress") return "En curso";
    return "Cerrada";
  }, [workOrder?.status]);

  const canStart = workOrder?.isOpen === true && (workOrder?.status === "open" || !workOrder?.status);
  const canClose = workOrder?.isOpen === true;

  const [starting, setStarting] = useState(false);
  const [closing, setClosing] = useState(false);

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

  const startWorkOrder = async () => {
    if (!app || !organizationId || !woId) return;

    setStarting(true);
    try {
      const fn = httpsCallable(getFunctions(app), "workOrders_start");
      await fn({ organizationId, woId });
      toast({ title: "OT iniciada", description: "Estado actualizado a 'En curso'." });
    } catch (err: any) {
      console.error("workOrders_start failed", err);
      toast({
        title: "No se pudo iniciar",
        description: err?.message ?? "Error inesperado",
        variant: "destructive",
      });
    } finally {
      setStarting(false);
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
      headerContent={
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/preventive" className="flex items-center gap-2">
                <span>Volver</span>
              </Link>
            </Button>
            <h1 className="text-lg font-semibold leading-tight md:text-xl">Detalle de OT</h1>
          </div>
        </div>
      }
    >
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
              <CardDescription>
                ID: <span className="font-mono">{workOrder.id}</span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Prioridad: {workOrder.priority ?? "Media"}</Badge>
                {workOrder.preventiveTemplateId ? (
                  <Badge variant="secondary">Plantilla: {workOrder.preventiveTemplateId}</Badge>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={startWorkOrder} disabled={!canStart || starting}>
                  {starting ? <Icons.spinner className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Iniciar
                </Button>
                <Button variant="destructive" onClick={closeWorkOrder} disabled={!canClose || closing}>
                  {closing ? <Icons.spinner className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Cerrar
                </Button>
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
    </AppShell>
  );
}
