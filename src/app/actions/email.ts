'use server'

const RESEND_API_URL = 'https://api.resend.com/emails';

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
    const fromAddress =
      process.env.RESEND_FROM ?? 'Maintelligence <noreply@maintelligence.app>';

    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // ⚠️ IMPORTANTE: 'onboarding@resend.dev' solo funciona si envías a tu propio email de registro.
        // Para producción, debes verificar tu dominio en Resend y cambiar esto (ej: 'avisos@tudominio.com').
        from: fromAddress,
        to,
        subject,
        html,
        text,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("❌ Resend API error:", response.status, errorBody);
      return { success: false, error: `Resend API error: ${response.status}` };
    }

    const data = await response.json();
    console.log("✅ Email enviado:", data);
    return { success: true, data };
  } catch (error) {
    console.error("❌ Error enviando email:", error);
    return { success: false, error };
  }
}
