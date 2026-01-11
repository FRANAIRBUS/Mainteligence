"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendInviteEmail = void 0;
const params_1 = require("firebase-functions/params");
const resend_1 = require("resend");
const buildInviteEmailContent = ({ orgName, role, inviteLink }) => {
    const subject = `Invitación a ${orgName} en Maintelligence`;
    const text = [
        `Has sido invitado a unirte a ${orgName} como ${role}.`,
        `Accede aquí para registrarte o iniciar sesión: ${inviteLink}`,
    ].join('\n');
    const html = `
    <table style="width:100%; max-width:640px; margin:0 auto; font-family: 'Inter', system-ui, -apple-system, sans-serif; border:1px solid #e5e7eb; border-radius: 12px; overflow:hidden;">
      <tr>
        <td style="background:linear-gradient(135deg, #111827, #1f2937); padding:24px 24px; color:#f9fafb;">
          <div style="font-size:14px; letter-spacing:0.5px; text-transform:uppercase; opacity:0.8;">Invitación a tu organización</div>
          <div style="font-size:22px; font-weight:700; margin-top:4px;">${orgName}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 24px 8px; color:#111827;">
          <p style="margin:0 0 12px; font-size:16px;">Has sido invitado a unirte a <strong>${orgName}</strong> como <strong>${role}</strong>.</p>
          <p style="margin:0 0 12px; font-size:14px; color:#4b5563;">Usa el siguiente enlace para registrarte o iniciar sesión.</p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px 24px;">
          <a href="${inviteLink}" style="display:inline-block; background:#111827; color:#f9fafb; padding:12px 18px; border-radius:10px; text-decoration:none; font-weight:600;">Entrar a Maintelligence</a>
          <p style="margin:12px 0 0; font-size:12px; color:#6b7280;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br/>${inviteLink}</p>
        </td>
      </tr>
    </table>
  `;
    return { subject, text, html };
};
const RESEND_API_KEY = (0, params_1.defineString)('RESEND_API_KEY');
const RESEND_FROM = (0, params_1.defineString)('RESEND_FROM');
const sendInviteEmail = async (input) => {
    const resendKey = RESEND_API_KEY.value();
    const resendFrom = RESEND_FROM.value();
    if (!resendKey || !resendFrom) {
        console.warn('Resend no configurado: RESEND_API_KEY/RESEND_FROM faltante.');
        return;
    }
    const { subject, html, text } = buildInviteEmailContent(input);
    const resend = new resend_1.Resend(resendKey);
    await resend.emails.send({
        from: resendFrom,
        to: input.recipientEmail,
        subject,
        html,
        text,
    });
};
exports.sendInviteEmail = sendInviteEmail;
//# sourceMappingURL=invite-email.js.map