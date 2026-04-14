import nodemailer from 'nodemailer';
import { config } from './config';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: config.resend.fromEmail,
    pass: config.resend.apiKey,
  },
});

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}) {
  const result = await transporter.sendMail({
    from: `${config.resend.fromName} <${config.resend.fromEmail}>`,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    replyTo: opts.replyTo || config.resend.replyToEmail,
  });

  return { data: { id: result.messageId }, error: null };
}
