import nodemailer from 'nodemailer';
import type { OtpPurpose } from '@/generated/prisma/client';

export interface Mailer {
  send(to: string, subject: string, text: string, html: string): Promise<void>;
}

let override: Mailer | null = null;

/** For tests only. */
export function setMailerForTests(mailer: Mailer | null) {
  override = mailer;
}

function smtpMailer(): Mailer {
  // No connection pool: serverless functions shouldn't hold connections open.
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10_000,
    socketTimeout: 10_000,
  });
  return {
    async send(to, subject, text, html) {
      await transporter.sendMail({ from: process.env.EMAIL_FROM, to, subject, text, html });
    },
  };
}

function mailer() {
  return override ?? smtpMailer();
}

export async function sendOtpEmail(to: string, code: string, purpose: OtpPurpose) {
  const action = purpose === 'REGISTER' ? 'verify your email' : 'reset your password';
  const text = `Your Cardiomen code is ${code}\n\nUse it to ${action}. It expires in 10 minutes.\nIf this wasn't you, you can ignore this email.`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:auto;padding:24px;color:#000">
<p>Use this code to ${action}:</p>
<p style="font-size:32px;letter-spacing:6px;font-weight:600;margin:16px 0">${code}</p>
<p style="color:#555">It expires in 10 minutes. If this wasn't you, you can ignore this email.</p>
</div>`;
  await mailer().send(to, `${code} is your Cardiomen code`, text, html);
}

export async function sendAccountExistsEmail(to: string) {
  const text =
    "Someone tried to create a Cardiomen account with this email, but you already have one.\n\nSign in instead, or reset your password if you've forgotten it. If this wasn't you, you can ignore this email.";
  await mailer().send(to, 'You already have a Cardiomen account', text, `<p>${text.replace(/\n\n/g, '</p><p>')}</p>`);
}
