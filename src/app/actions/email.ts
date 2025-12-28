'use server'

import { Resend } from 'resend';

// Asegúrate de tener RESEND_API_KEY en tu archivo .env
const resend = new Resend(process.env.RESEND_API_KEY);

interface EmailPayload {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export async function sendEmailAction({ to, subject, html, text }: EmailPayload) {
  if (!process.env.RESEND_API_KEY) {
    console.error("Falta la RESEND_API_KEY en las variables de entorno");
    return { success: false, error: "Configuration Error" };
  }

  try {
    const data = await resend.emails.send({
      from: 'Mainteligence <onboarding@resend.dev>', // ⚠️ IMPORTANTE: Cámbialo por tu dominio verificado cuando pases a producción (ej: avisos@tuempresa.com)
      to: to,
      subject: subject,
      html: html,
      text: text,
    });

    console.log("Email enviado con éxito:", data);
    return { success: true, data };
  } catch (error) {
    console.error("Error enviando email vía Resend:", error);
    return { success: false, error };
  }
}
