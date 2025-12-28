'use server'

import { Resend } from 'resend';

// Inicializa Resend con la API Key del entorno
const resend = new Resend(process.env.RESEND_API_KEY);

interface EmailPayload {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export async function sendEmailAction({ to, subject, html, text }: EmailPayload) {
  // Verificación básica de seguridad
  if (!process.env.RESEND_API_KEY) {
    console.error("❌ ERROR: Falta RESEND_API_KEY en las variables de entorno.");
    return { success: false, error: "Configuration Error" };
  }

  try {
    const data = await resend.emails.send({
      // ⚠️ IMPORTANTE: 'onboarding@resend.dev' solo funciona si envías a tu propio email de registro.
      // Para producción, debes verificar tu dominio en Resend y cambiar esto (ej: 'avisos@tudominio.com').
      from: 'Mainteligence <onboarding@resend.dev>', 
      to: to,
      subject: subject,
      html: html,
      text: text,
    });

    console.log("✅ Email enviado:", data);
    return { success: true, data };
  } catch (error) {
    console.error("❌ Error enviando email:", error);
    return { success: false, error };
  }
}
