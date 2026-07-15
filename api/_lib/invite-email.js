/**
 * Branded invitation email (Resend). Falls back to no-op when RESEND_API_KEY is unset.
 */

import { getAppOrigin } from './magic-code-email.js';
import { maskEmail } from './invite-crypto.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildInviteEmailHtml({
  appName = 'Hey Pelo Ops',
  inviteUrl,
  email,
  role,
  storeNames = [],
  invitedByEmail,
  expiresAt,
}) {
  const storesLabel = storeNames.length ? storeNames.join(', ') : 'Assigned at approval';
  const expiryLabel = expiresAt
    ? new Date(expiresAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : '7 days';

  return /* html */ `
<div style="background:#f5f5f4;padding:28px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;padding:28px 24px;border-radius:12px;">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#a16207;">${escapeHtml(appName)}</p>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#1c1917;">You've been invited to join ${escapeHtml(appName)}</h1>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.5;color:#57534e;">
      This invitation is for <strong>${escapeHtml(email)}</strong> only.
      You may be asked to install the app on your device after signing in.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 22px;font-size:13px;color:#44403c;">
      <tr><td style="padding:6px 0;color:#78716c;">Email</td><td style="padding:6px 0;text-align:right;">${escapeHtml(email)}</td></tr>
      <tr><td style="padding:6px 0;color:#78716c;">Role</td><td style="padding:6px 0;text-align:right;">${escapeHtml(role)}</td></tr>
      <tr><td style="padding:6px 0;color:#78716c;">Stores</td><td style="padding:6px 0;text-align:right;">${escapeHtml(storesLabel)}</td></tr>
      <tr><td style="padding:6px 0;color:#78716c;">Invited by</td><td style="padding:6px 0;text-align:right;">${escapeHtml(invitedByEmail || 'Administrator')}</td></tr>
      <tr><td style="padding:6px 0;color:#78716c;">Expires</td><td style="padding:6px 0;text-align:right;">${escapeHtml(expiryLabel)}</td></tr>
    </table>
    <p style="margin:0 0 18px;">
      <a href="${escapeHtml(inviteUrl)}"
         style="display:inline-block;background:#1c1917;color:#ffffff;padding:14px 20px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600;">
        Accept invitation and open app
      </a>
    </p>
    <p style="margin:0 0 12px;font-size:12px;line-height:1.5;color:#78716c;">
      If the button does not work, copy and open this secure invitation link:<br/>
      <span style="word-break:break-all;color:#44403c;">${escapeHtml(inviteUrl)}</span>
    </p>
    <p style="margin:0;font-size:12px;line-height:1.5;color:#a8a29e;">
      This link does not install the app by itself — your browser will ask you to confirm installation if available.
      If you were not expecting this invitation, you can ignore this email or contact your administrator.
    </p>
  </div>
</div>
`.trim();
}

export async function sendInviteEmail(payload) {
  const apiKey = process.env.RESEND_API_KEY || '';
  if (!apiKey) {
    return { sent: false, reason: 'RESEND_API_KEY not configured' };
  }

  const from =
    process.env.RESEND_FROM ||
    process.env.INVITE_FROM_EMAIL ||
    'Hey Pelo Ops <onboarding@resend.dev>';

  const subject = `You've been invited to join Hey Pelo Ops`;
  const html = buildInviteEmailHtml(payload);

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [payload.email],
      subject,
      html,
      text: [
        `You've been invited to join Hey Pelo Ops.`,
        `Accept invitation: ${payload.inviteUrl}`,
        `Intended for: ${payload.email} (${maskEmail(payload.email)})`,
        `Role: ${payload.role}`,
      ].join('\n'),
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.message || `Resend failed (${resp.status})`);
  }

  return { sent: true, id: data.id, appOrigin: getAppOrigin() };
}
