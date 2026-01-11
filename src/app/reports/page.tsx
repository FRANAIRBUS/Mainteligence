--- src/app/reports/page.tsx
+++ src/app/reports/page.tsx (mobile-fix)
@@ -69,6 +69,7 @@
 } from '@/lib/reports/export';
 import { useToast } from '@/hooks/use-toast';
+import { useIsMobile } from '@/hooks/use-mobile';

 export default function ReportsPage() {
   const { user, loading } = useUser();
@@ -80,6 +81,7 @@
   const [exportSortOrder, setExportSortOrder] = useState<ExportSortOrder>('desc');
   const [isExporting, setIsExporting] = useState(false);
   const { toast } = useToast();
+  const isMobile = useIsMobile();

@@ -355,7 +357,7 @@
     <AppShell
       title="Informes"
       description="Genera y visualiza informes detallados del mantenimiento."
     >
-      <div className="w-full max-w-full space-y-6 overflow-hidden">
+      <div className="w-full max-w-full space-y-6">
         <Card>
@@ -395,7 +397,7 @@
                   <Input
                     type="date"
                     value={startDate}
                     onChange={(event) => setStartDate(event.target.value)}
-                    className="h-9 w-[140px] min-w-0 text-xs sm:text-sm"
+                    className="h-9 w-full min-w-0 text-xs sm:w-[140px] sm:text-sm"
                     aria-label="Fecha de inicio"
                   />
@@ -412,7 +414,7 @@
                   <Input
                     type="date"
                     value={endDate}
                     onChange={(event) => setEndDate(event.target.value)}
-                    className="h-9 w-[140px] min-w-0 text-xs sm:text-sm"
+                    className="h-9 w-full min-w-0 text-xs sm:w-[140px] sm:text-sm"
                     aria-label="Fecha de fin"
                   />
@@ -427,7 +429,7 @@
               </span>
               <Select value={locationFilter} onValueChange={setLocationFilter}>
-                <SelectTrigger className="min-w-0 w-[220px] max-w-full">
+                <SelectTrigger className="min-w-0 w-full max-w-full sm:w-[220px]">
                   <SelectValue placeholder="Todas" />
                 </SelectTrigger>
@@ -456,7 +458,7 @@
               <Select
                 value={departmentFilter}
                 onValueChange={setDepartmentFilter}
               >
-                <SelectTrigger className="min-w-0 w-[220px] max-w-full">
+                <SelectTrigger className="min-w-0 w-full max-w-full sm:w-[220px]">
                   <SelectValue placeholder="Todos" />
                 </SelectTrigger>

@@ -706,7 +708,44 @@
               <h3 className="text-sm font-semibold text-muted-foreground">
                 Cumplimiento por plantilla
               </h3>
-              <div className="w-full max-w-full overflow-x-auto rounded-lg border md:overflow-visible">
+              {/* Mobile cards */}
+              <div className="space-y-3 md:hidden">
+                {preventiveCompliance.templates.length ? (
+                  preventiveCompliance.templates.map((template) => (
+                    <div key={template.templateId} className="rounded-lg border p-3">
+                      <div className="flex items-start justify-between gap-3">
+                        <div className="min-w-0">
+                          <p className="font-medium leading-tight">
+                            {template.templateName}
+                          </p>
+                          <p className="mt-1 text-xs text-muted-foreground">
+                            En plazo: <span className="font-medium text-foreground">{template.onTime}</span>{" "}
+                            · Fuera: <span className="font-medium text-foreground">{template.late}</span>
+                          </p>
+                        </div>
+                        <Badge variant="secondary" className="shrink-0">
+                          {template.complianceRate !== null
+                            ? `${template.complianceRate.toFixed(1)}%`
+                            : 'Sin datos'}
+                        </Badge>
+                      </div>
+                    </div>
+                  ))
+                ) : (
+                  <div className="flex h-24 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
+                    No hay preventivos completados con plantilla.
+                  </div>
+                )}
+              </div>
+
+              {/* Desktop table */}
+              <div className="hidden md:block w-full max-w-full overflow-x-auto rounded-lg border md:overflow-visible">
                 <Table className="w-full min-w-0">

@@ -770,7 +809,40 @@
         <Card>
           <CardHeader>
             <CardTitle>Rendimiento por operario</CardTitle>
@@ -777,8 +849,41 @@
           </CardHeader>
-          <CardContent className="w-full max-w-full overflow-x-auto md:overflow-visible">
-            <Table className="w-full min-w-0">
+          <CardContent className="space-y-3">
+            {/* Mobile cards */}
+            <div className="space-y-3 md:hidden">
+              {operatorRows.length > 0 ? (
+                operatorRows.map((row) => (
+                  <div key={row.userId} className="rounded-lg border p-3">
+                    <div className="flex items-start justify-between gap-3">
+                      <div className="min-w-0">
+                        <p className="font-medium truncate">{row.label}</p>
+                        <p className="mt-1 text-xs text-muted-foreground">
+                          MTTR: <span className="font-medium text-foreground">{row.mttrLabel}</span>
+                        </p>
+                      </div>
+                      <Badge variant="secondary" className="shrink-0">
+                        {row.closedCount} cerradas
+                      </Badge>
+                    </div>
+                  </div>
+                ))
+              ) : (
+                <div className="flex h-24 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
+                  No hay cierres en el rango seleccionado.
+                </div>
+              )}
+            </div>
+
+            {/* Desktop table */}
+            <div className="hidden md:block w-full max-w-full overflow-x-auto md:overflow-visible">
+              <Table className="w-full min-w-0">
                 <TableHeader>
@@ -822,7 +927,8 @@
               </TableBody>
             </Table>
+            </div>
           </CardContent>
         </Card>

@@ -833,10 +939,62 @@
         <Card>
           <CardHeader>
             <CardTitle>Auditoría</CardTitle>
@@ -846,7 +1004,59 @@
           </CardHeader>
           <CardContent className="space-y-4">
-            <div className="w-full max-w-full overflow-x-auto md:overflow-visible">
+            {/* Mobile cards */}
+            <div className="space-y-3 md:hidden">
+              {recentClosures.length > 0 ? (
+                recentClosures.map(({ ticket }) => (
+                  <div key={ticket.id} className="rounded-lg border p-3">
+                    <div className="flex items-start justify-between gap-3">
+                      <div className="min-w-0 space-y-1">
+                        <Link href={`/incidents/${ticket.id}`} className="font-medium text-primary hover:underline">
+                          {ticket.displayId ?? ticket.title}
+                        </Link>
+                        <p className="text-xs text-muted-foreground">
+                          Cierre: <span className="font-medium text-foreground">{formatDateTime(ticket.closedAt)}</span>
+                        </p>
+                        <p className="text-xs text-muted-foreground">
+                          Operario: <span className="font-medium text-foreground">{operatorLabelForTicket(ticket)}</span>
+                        </p>
+                      </div>
+                      <div className="shrink-0 text-right">
+                        {ticket.reportPdfUrl ? (
+                          <a
+                            href={ticket.reportPdfUrl}
+                            target="_blank"
+                            rel="noreferrer"
+                            className="text-sm font-medium text-primary hover:underline"
+                          >
+                            Ver PDF
+                          </a>
+                        ) : (
+                          <span className="text-xs text-muted-foreground">Sin PDF</span>
+                        )}
+                      </div>
+                    </div>
+                  </div>
+                ))
+              ) : (
+                <div className="flex h-24 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
+                  No hay cierres recientes para mostrar.
+                </div>
+              )}
+            </div>
+
+            {/* Desktop table */}
+            <div className="hidden md:block w-full max-w-full overflow-x-auto md:overflow-visible">
               <Table className="w-full min-w-0">

@@ -1036,7 +1246,26 @@
                     <XAxis
                       dataKey="label"
                       tickLine={false}
                       axisLine={false}
-                      interval={0}
+                      interval={isMobile ? "preserveStartEnd" : 0}
+                      minTickGap={isMobile ? 24 : 8}
+                      angle={isMobile ? -30 : 0}
+                      textAnchor={isMobile ? "end" : "middle"}
+                      height={isMobile ? 60 : undefined}
                       tickMargin={8}
+                      tickFormatter={(value) => {
+                        const label = String(value ?? '');
+                        if (!isMobile) return label;
+                        return label.length > 14 ? `${label.slice(0, 14)}…` : label;
+                      }}
                     />
@@ -1095,7 +1324,26 @@
                     <XAxis
                       dataKey="label"
                       tickLine={false}
                       axisLine={false}
-                      interval={0}
+                      interval={isMobile ? "preserveStartEnd" : 0}
+                      minTickGap={isMobile ? 24 : 8}
+                      angle={isMobile ? -30 : 0}
+                      textAnchor={isMobile ? "end" : "middle"}
+                      height={isMobile ? 60 : undefined}
                       tickMargin={8}
+                      tickFormatter={(value) => {
+                        const label = String(value ?? '');
+                        if (!isMobile) return label;
+                        return label.length > 14 ? `${label.slice(0, 14)}…` : label;
+                      }}
                     />