import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { Resend } from "resend";

admin.initializeApp();

// Configura Resend usando la variable de entorno
const resend = new Resend(functions.config().resend.apikey);

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

    if (!newData) return; 

    const newAssignee = newData.userId; 
    const oldAssignee = oldData?.userId;

    // Solo si hay asignado y ha cambiado
    if (newAssignee && newAssignee !== oldAssignee) {
      const email = await getUserEmail(newAssignee);
      
      if (!email) {
        console.log(`Usuario ${newAssignee} sin email.`);
        return;
      }

      const isNew = !oldData;
      const subject = isNew 
        ? `🆕 Nueva Tarea: ${newData.title}`
        : `🔄 Tarea Actualizada: ${newData.title}`;

      try {
        await resend.emails.send({
          // 👇 AQUÍ HEMOS PUESTO TU DOMINIO REAL
          from: "Mainteligence <avisos@maintelligence.app>", 
          to: email,
          subject: subject,
          html: `
            <div style="font-family: sans-serif; padding: 20px;">
              <h2 style="color: #2563EB;">${subject}</h2>
              <p>Hola,</p>
              <p>Se te ha asignado la tarea: <strong>${newData.title}</strong></p>
              <p>Prioridad: ${newData.priority || 'Normal'}</p>
              <br/>
              <a href="https://maintelligence.app/tasks/${context.params.taskId}" 
                 style="background: #2563EB; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
                 Ver Tarea
              </a>
            </div>
          `
        });
        console.log(`Correo enviado a ${email}`);
      } catch (error) {
        console.error("Error enviando correo:", error);
      }
    }
  });

// --- Trigger para INCIDENCIAS (Tickets) ---
export const onTicketAssign = functions.firestore
  .document("tickets/{ticketId}")
  .onWrite(async (change, context) => {
    const newData = change.after.data();
    const oldData = change.before.data();

    if (!newData) return;

    const newAssignee = newData.assignedTo;
    const oldAssignee = oldData?.assignedTo;

    if (newAssignee && newAssignee !== oldAssignee) {
      const email = await getUserEmail(newAssignee);
      if (!email) return;

      try {
        await resend.emails.send({
          // 👇 DOMINIO ACTUALIZADO
          from: "Mainteligence <avisos@maintelligence.app>", 
          to: email,
          subject: `🚨 Incidencia Asignada: ${newData.title}`,
          html: `
            <div style="font-family: sans-serif; padding: 20px;">
              <h2 style="color: #DC2626;">🚨 Incidencia Asignada</h2>
              <p>Incidencia: <strong>${newData.title}</strong></p>
              <p>Descripción: ${newData.description}</p>
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
