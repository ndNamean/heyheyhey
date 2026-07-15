/**
 * Upsert InstantDB Custom Magic Code Email (code-only branding).
 * Invitation deep links are sent separately via Resend.
 *
 *   node scripts/setup-magic-code-email.mjs
 */

import {
  buildMagicCodeEmailBody,
  getAppOrigin,
  MAGIC_CODE_EMAIL_SUBJECT,
} from '../api/_lib/magic-code-email.js';

const APP_ID =
  process.env.VITE_INSTANT_APP_ID ||
  process.env.INSTANT_APP_ID ||
  'f7ac027e-2079-41eb-8f34-aa0e4543ca71';

const ADMIN_TOKEN =
  process.env.INSTANT_ADMIN_TOKEN ||
  process.env.INSTANT_APP_ADMIN_TOKEN ||
  process.env.INSTANT_CLI_AUTH_TOKEN ||
  '';

if (!ADMIN_TOKEN) {
  console.error('Missing INSTANT_ADMIN_TOKEN');
  process.exit(1);
}

const body = buildMagicCodeEmailBody();

const res = await fetch(`https://api.instantdb.com/dash/apps/${APP_ID}/email_templates`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${ADMIN_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    'email-type': 'magic-code',
    subject: MAGIC_CODE_EMAIL_SUBJECT,
    body,
    'sender-name': 'Hey Pelo Ops',
  }),
});

const text = await res.text();
let json = null;
try {
  json = text ? JSON.parse(text) : null;
} catch {
  /* ignore */
}

if (!res.ok) {
  console.error('Failed to save Instant email template', res.status, text);
  process.exit(1);
}

console.log('Magic code email template saved (code-only).');
console.log('App origin (invites use /invite?token= via Resend):', getAppOrigin());
console.log('Template id:', json?.id ?? '(ok)');
