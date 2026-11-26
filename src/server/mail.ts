import { IS_PROD, IS_TEST } from './paths';

/*
 * Sending email through Brevo (https://brevo.com, free for 300 emails a day) or Resend
 * (https://resend.com, free for 3,000 a month), using their HTTP APIs, so no extra package is
 * needed. Set ONE of the two keys:
 *
 *   BREVO_API_KEY   from Brevo → SMTP & API → API Keys
 *   RESEND_API_KEY  from resend.com → API Keys
 *   MAIL_FROM       e.g. "HandleMyDesk <you@yourdomain.com>": a sender verified in Brevo / Resend
 *   APP_URL         the website people use, e.g. https://handlemydesk.vercel.app (links in emails)
 *
 * Without them the app still works: "Forgot password?" asks an administrator instead.
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

type Sender = (mail: Mail) => Promise<void>;
let testSender: Sender | null = null;

/** Tests capture mail instead of sending it. */
export function setMailSenderForTests(sender: Sender | null): void {
  testSender = sender;
}

export function mailConfigured(): boolean {
  if (IS_TEST) return !!testSender;
  return !!((process.env.BREVO_API_KEY || process.env.RESEND_API_KEY) && process.env.MAIL_FROM && appUrl());
}

/**
 * The website address for links in emails. It comes from settings, never from the request:
 * otherwise anyone could make the app email a reset link pointing at their own site.
 */
export function appUrl(): string | null {
  const fromEnv = process.env.APP_URL?.trim().replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  if (IS_TEST) return 'http://localhost:5173';
  if (!IS_PROD) return 'http://localhost:5173';
  return null;
}

export async function sendMail(mail: Mail): Promise<void> {
  if (testSender) return testSender(mail);
  if (!mailConfigured()) throw new Error('Email is not set up');
  const res = process.env.BREVO_API_KEY ? await sendWithBrevo(mail) : await sendWithResend(mail);
  if (!res.ok) throw new Error(`Email service answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

/** "HandleMyDesk <you@example.com>" → name and address. */
export function parseFrom(from: string): { name?: string; email: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : { email: from.trim() };
}

function sendWithBrevo(mail: Mail): Promise<Response> {
  return fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY!, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ sender: parseFrom(process.env.MAIL_FROM!), to: [{ email: mail.to }], subject: mail.subject, textContent: mail.text, htmlContent: mail.html }),
    signal: AbortSignal.timeout(10_000),
  });
}

function sendWithResend(mail: Mail): Promise<Response> {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
    signal: AbortSignal.timeout(10_000),
  });
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A plain, readable email with one or more buttons. */
export function simpleEmail(opts: { greeting: string; paragraphs: string[]; buttons: Array<{ label: string; url: string }>; footer: string; accent?: string }): { text: string; html: string } {
  const accent = opts.accent && /^#[0-9a-f]{6}$/i.test(opts.accent) ? opts.accent : '#2b63d9';
  const text = [opts.greeting, '', ...opts.paragraphs.flatMap((p) => [p, '']), ...opts.buttons.flatMap((b) => [`${b.label}:`, b.url, '']), opts.footer].join('\n');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f6f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f1f1e">
<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e7e7e5;border-radius:8px;padding:24px">
<p style="margin:0 0 16px;font-size:15px">${escapeHtml(opts.greeting)}</p>
${opts.paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#5c5b58">${escapeHtml(p)}</p>`).join('\n')}
${opts.buttons
  .map(
    (b) =>
      `<p style="margin:0 0 12px"><a href="${escapeHtml(b.url)}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:6px">${escapeHtml(b.label)}</a></p>`
  )
  .join('\n')}
<p style="margin:20px 0 0;font-size:12px;color:#75746f">${escapeHtml(opts.footer)}</p>
</div></body></html>`;
  return { text, html };
}
