import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { Resend } from "resend";

admin.initializeApp();

const resendApiKey = functions.config().resend?.apikey;

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

    if (newAssignee && newAssignee !== oldAssignee) {
      const email = await getUserEmail(newAssignee);
      if (!email) return;

      try {
        await resend.emails.send({
          from: "Mainteligence <avisos@maintelligence.app>", 
          to: email,
          subject: `🆕 Tarea Asignada: ${newData.title}`,
          html: `<p>Se te ha asignado la tarea: <strong>${newData.title}</strong></p>
                 <a href="https://maintelligence.app/tasks/${context.params.taskId}">Ver tarea</a>`
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
          from: "Mainteligence <avisos@maintelligence.app>", 
          to: email,
          subject: `🚨 Incidencia Asignada: ${newData.title}`,
          html: `<p>Nueva incidencia: <strong>${newData.title}</strong></p>`
        });
      } catch (e) { console.error(e); }
    }
  });
