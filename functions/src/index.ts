import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { Resend } from "resend";

admin.initializeApp();

const resendApiKey = functions.config().resend?.apikey;
const resendFrom =
  functions.config().resend?.from ||
  process.env.RESEND_FROM ||
  "Maintelligence <noreply@maintelligence.app>";

async function getUserEmail(userId: string): Promise<string | undefined> {
  const snapshot = await admin.firestore().collection("users").doc(userId).get();
  return snapshot.data()?.email;
}

export const onTaskAssign = functions.firestore
  .document("tasks/{taskId}")
  .onWrite(async (change, context) => {
    const newData = change.after.data();
    const oldData = change.before.data();

    if (!newData || !resendApiKey) return;

    const resend = new Resend(resendApiKey);
    const newAssignee = newData.assignedTo;
    const oldAssignee = oldData?.assignedTo;

    const formatDate = (dateValue: any) => {
      if (!dateValue) return "Sin fecha";
      try {
        const date = typeof dateValue.toDate === "function" ? dateValue.toDate() : new Date(dateValue);
        return new Intl.DateTimeFormat("es-ES", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(date);
      } catch (e) {
        console.error("No se pudo formatear la fecha de la tarea", e);
        return "Sin fecha";
      }
    };

    const taskDetails = (
      taskId: string,
      data: any
    ): { label: string; value: string }[] => [
      { label: "Título", value: data.title || "(sin título)" },
      { label: "ID", value: data.identifier || taskId },
      { label: "Estado", value: data.status || "pendiente" },
      { label: "Prioridad", value: data.priority || "media" },
      { label: "Fecha límite", value: formatDate(data.dueDate) },
      { label: "Ubicación / Departamento", value: data.location || "No especificado" },
      { label: "Categoría", value: data.category || "No especificada" },
      { label: "Descripción", value: data.description || "Sin descripción" },
    ];

    if (newAssignee && newAssignee !== oldAssignee) {
      const email = await getUserEmail(newAssignee);
      if (!email) return;

      try {
        const details = taskDetails(context.params.taskId, newData);
        const detailRows = details
          .map(
            (item) =>
              `<tr><td style="padding: 8px 12px; font-weight: 600; color: #111827;">${item.label}</td><td style="padding: 8px 12px; color: #374151;">${item.value}</td></tr>`
          )
          .join("");

        const html = `
          <table style="width:100%; max-width:640px; margin:0 auto; font-family: 'Inter', system-ui, -apple-system, sans-serif; border:1px solid #e5e7eb; border-radius: 12px; overflow:hidden;">
            <tr>
              <td style="background:linear-gradient(135deg, #111827, #1f2937); padding:24px 24px; color:#f9fafb;">
                <div style="font-size:14px; letter-spacing:0.5px; text-transform:uppercase; opacity:0.8;">Nueva tarea asignada</div>
                <div style="font-size:22px; font-weight:700; margin-top:4px;">${newData.title || "Tarea"}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 24px 8px; color:#111827;">
                <p style="margin:0 0 12px; font-size:16px;">Se te ha asignado una nueva tarea. Aquí tienes los detalles:</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 16px 8px;">
                <table style="width:100%; border-collapse:collapse;">
                  <tbody>${detailRows}</tbody>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 24px;">
                <a href="https://maintelligence.app/tasks/${context.params.taskId}" style="display:inline-block; background:#111827; color:#f9fafb; padding:12px 18px; border-radius:10px; text-decoration:none; font-weight:600;">Ver tarea</a>
                <p style="margin:12px 0 0; font-size:12px; color:#6b7280;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br/>https://maintelligence.app/tasks/${context.params.taskId}</p>
              </td>
            </tr>
          </table>
        `;

        const text = [
          `Nueva tarea asignada: ${newData.title || "Tarea"}`,
          `ID: ${newData.identifier || context.params.taskId}`,
          `Estado: ${newData.status || "pendiente"}`,
          `Prioridad: ${newData.priority || "media"}`,
          `Fecha límite: ${formatDate(newData.dueDate)}`,
          `Ubicación / Departamento: ${newData.location || "No especificado"}`,
          `Categoría: ${newData.category || "No especificada"}`,
          `Descripción: ${newData.description || "Sin descripción"}`,
          `Ver tarea: https://maintelligence.app/tasks/${context.params.taskId}`,
        ].join("\n");

        await resend.emails.send({
          from: resendFrom,
          to: email,
          subject: `🆕 Tarea Asignada: ${newData.title}`,
          html,
          text,
        });
      } catch (e) { console.error(e); }
    }
  });

export const onTicketAssign = functions.firestore
  .document("tickets/{ticketId}")
  .onWrite(async (change, context) => {
    const newData = change.after.data();
    const oldData = change.before.data();
    if (!newData || !resendApiKey) return;

    const resend = new Resend(resendApiKey);
    const newAssignee = newData.assignedTo;
    if (newAssignee && newAssignee !== oldData?.assignedTo) {
      const email = await getUserEmail(newAssignee);
      if (!email) return;
      try {
        await resend.emails.send({
          from: resendFrom,
          to: email,
          subject: `🚨 Incidencia Asignada: ${newData.title}`,
          html: `<p>Nueva incidencia: <strong>${newData.title}</strong></p>`
        });
      } catch (e) { console.error(e); }
    }
  });
