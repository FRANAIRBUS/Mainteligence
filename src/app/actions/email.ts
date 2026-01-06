'use server'

const RESEND_API_URL = 'https://api.resend.com/emails';

const normalizeRecipients = (recipients: string[]) =>
  Array.from(new Set(recipients.map((item) => item?.trim()).filter(Boolean)));

interface EmailPayload {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export async function sendEmailAction({ to, subject, html, text }: EmailPayload) {
  if (!process.env.RESEND_API_KEY) {
    console.error("❌ ERROR: Falta RESEND_API_KEY en las variables de entorno.");
    return { success: false, error: "Configuration Error" };
  }

  if (!process.env.RESEND_FROM) {
    console.error(
      "❌ ERROR: Falta RESEND_FROM. Configura un remitente verificado en Resend (p. ej. 'avisos@tudominio.com')."
    );
    return { success: false, error: "Missing RESEND_FROM" };
  }

  const recipients = normalizeRecipients(to);

  if (!recipients.length) {
    console.warn("⚠️ No se enviará email: lista de destinatarios vacía tras normalización.");
    return { success: false, error: "No recipients" };
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // ⚠️ IMPORTANTE: 'onboarding@resend.dev' solo funciona si envías a tu propio email de registro.
        // Para producción, debes verificar tu dominio en Resend y cambiar esto (ej: 'avisos@tudominio.com').
        from: process.env.RESEND_FROM,
        to: recipients,
        subject,
        html,
        text,
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      let errorBody: string | undefined;
      try {
        errorBody = await response.text();
      } catch (error) {
        console.warn("⚠️ No se pudo leer el cuerpo de error de Resend:", error);
      }

      console.error("❌ Resend API error:", response.status, errorBody ?? "(sin cuerpo)");
      return {
        success: false,
        error: `Resend API error: ${response.status}${errorBody ? ` - ${errorBody}` : ''}`,
      };
    }

    const data = await response.json();
    console.log("✅ Email enviado:", data);
    return { success: true, data };
  } catch (error) {
    console.error("❌ Error enviando email:", error);
    return { success: false, error };
  }
}
