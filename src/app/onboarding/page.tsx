"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";

export default function OnboardingFallback() {
  return (
    <AppShell title="Completa tu registro" description="Falta información de la organización.">
      <div className="flex justify-center">
        <Card className="max-w-xl w-full">
          <CardHeader className="flex flex-row items-center gap-3">
            <div className="rounded-full bg-destructive/10 p-2 text-destructive">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div>
              <CardTitle className="text-lg">Información incompleta</CardTitle>
              <p className="text-sm text-muted-foreground">
                No encontramos un <strong>organizationId</strong> en tu perfil. Completa tu
                registro o contacta a un administrador.
              </p>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/profile">Ir a mi perfil</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/login">Cambiar de cuenta</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
