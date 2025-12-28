import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { Resend } from "resend";

admin.initializeApp();

// Configura Resend usando la variable de entorno con seguridad
const resendApiKey = functions.config().resend?.apikey;

async function getUserEmail(userId: string): Promise<string | undefined> {
  const snapshot = await admin.firestore().collection("users").doc(userId).get();
  return snapshot.data()?.email;
}

// --- Trigger para TAREAS (Tasks) ---
export const onTaskAssign = functions.firestore
  .document("tasks/{taskId}")
  .onWrite(async (change, context) => {
    const newData = change.after.data();
    const oldData = change.before.data();

    if (!newData) return; // Documento borrado

    if (!resendApiKey) {
      console.error("Falta la API Key de Resend en functions.config().resend.apikey");
      return;
    }

    const resend = new Resend(resendApiKey);

    // IMPORTANTE: Tu componente envía 'userId', así que usamos ese campo
    const newAssignee = newData.userId; 
    const oldAssignee = oldData?.userId;

    // Solo si el usuario asignado ha cambiado o es nuevo
    if (newAssignee && newAssignee !== oldAssignee) {
      const email = await getUserEmail(newAssignee);
      
      if (!email) {
        console.log(`Usuario ${newAssignee} no tiene campo 'email' en su perfil.`);
        return;
      }

      const isNew = !oldData;
      const subject = isNew 
        ? `🆕 Nueva Tarea: ${newData.title}`
        : `🔄 Tarea Actualizada: ${newData.title}`;

      try {
        await resend.emails.send({
          from: "Mainteligence <avisos@maintelligence.app>", 
          to: email,
          subject: subject,
          html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
              <h2 style="color: #2563EB;">${subject}</h2>
              <p>Hola,</p>
              <p>Se te ha asignado la siguiente tarea:</p>
              <div style="background: #f9fafb; padding: 15px; border-radius: 5px;">
                <p><strong>Tarea:</strong> ${newData.title}</p>
                <p><strong>Prioridad:</strong> ${newData.priority || 'Normal'}</p>
                <p><strong>Estado:</strong> ${newData.status || 'Pendiente'}</p>
              </div>
              <br/>
              <a href="https://maintelligence.app/tasks/${context.params.taskId}" 
                 style="background: #2563EB; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; display: inline-block;">
                 Ver Detalles de la Tarea
              </a>
              <p style="font-size: 12px; color: #6b7280; margin-top: 20px;">
                Este es un aviso automático de Mainteligence.
              </p>
            </div>
          `
        });
        console.log(`Correo enviado con éxito a ${email}`);
      } catch (error) {
        console.error("Error de Resend:", error);
      }
    }
  });

// --- Trigger para INCIDENCIAS (Tickets) ---
export const onTicketAssign = functions.firestore
  .document("tickets/{ticketId}")
  .onWrite(async (change, context) => {
    const newData = change.after.data();
    const oldData = change.before.data();

    if (!newData || !resendApiKey) return;

    const resend = new Resend(resendApiKey);
    const newAssignee = newData.assignedTo;
    const oldAssignee = oldData?.assignedTo;

    if (newAssignee && newAssignee !== oldAssignee) {
      const email = await getUserEmail(newAssignee);
      if (!email) return;

      try {
        await resend.emails.send({
          from: "Mainteligence <avisos@maintelligence.app>", 
          to: email,
          subject: `🚨 Incidencia Asignada: ${newData.title}`,
          html: `
            <div style="font-family: sans-serif; padding: 20px;">
              <h2 style="color: #DC2626;">🚨 Nueva Incidencia Asignada</h2>
              <p>Has sido asignado para resolver la incidencia: <strong>${newData.title}</strong></p>
              <p>Descripción: ${newData.description || 'Sin descripción'}</p>
              <br/>
              <a href="https://maintelligence.app/incidents/${context.params.ticketId}" 
                 style="background: #DC2626; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                 Ver Incidencia
              </a>
            </div>
          `
        });
      } catch (error) {
        console.error("Error enviando correo ticket:", error);
      }
    }
  });
