/**
 * InstantDB magic-code email — code entry only (no OTP in URL).
 * Invitation deep-links use /invite?token=… via Resend.
 */

const DEFAULT_APP_ORIGIN = 'https://restaurant-ops-instant.vercel.app';

export function getAppOrigin() {
  const raw =
    process.env.APP_ORIGIN ||
    process.env.VITE_APP_ORIGIN ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    DEFAULT_APP_ORIGIN;
  const trimmed = String(raw).trim().replace(/\/$/, '');
  if (!trimmed) return DEFAULT_APP_ORIGIN;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return `https://${trimmed}`;
}

export function buildMagicCodeEmailBody() {
  return /* html */ `
<div style="background:#f5f5f4;padding:28px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;padding:28px 24px;border-radius:12px;">
    <p style="margin:0 0 8px;font-size:16px;color:#1c1917;">Your sign-in code</p>
    <p style="margin:0 0 18px;font-size:14px;line-height:1.5;color:#57534e;">
      Use this verification code for <strong>{app_title}</strong>:
    </p>
    <p style="margin:0 0 22px;font-size:30px;font-weight:700;letter-spacing:0.18em;color:#1c1917;">{code}</p>
    <p style="margin:0;font-size:12px;line-height:1.5;color:#78716c;">
      Enter this code in the app. It expires in {expiration} and can only be used once.
      If you did not request it, you can ignore this email.
    </p>
  </div>
</div>
`.trim();
}

export const MAGIC_CODE_EMAIL_SUBJECT = '{code} is your code for {app_title}';
