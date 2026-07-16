# Invite emails via Google Apps Script

Hey Pelo Ops sends branded invitation emails through a Google Apps Script Web App (Gmail), so no custom domain DNS is required.

## Priority

1. `GOOGLE_APPS_SCRIPT_URL` + `INVITE_EMAIL_SECRET` → Google Apps Script
2. Else `RESEND_API_KEY` → Resend
3. Else invite is created but email is not sent (copy the invite link)

## Vercel env

| Name | Description |
|------|-------------|
| `GOOGLE_APPS_SCRIPT_URL` | Web App `/exec` URL |
| `INVITE_EMAIL_SECRET` | Same value as Script Property `INVITE_EMAIL_SECRET` |

Redeploy production after changing env vars.

## Apps Script checklist

1. Script Property `INVITE_EMAIL_SECRET` set
2. Deploy as Web App: Execute as **Me**, access **Anyone**
3. After code edits: **Deploy → Manage deployments → New version**
4. Smoke-test with POST JSON: `secret`, `email`, `inviteUrl`, `role`, `storeNames`, `invitedByEmail`

## App code

- Transport: [`api/_lib/invite-email.js`](../api/_lib/invite-email.js)
- Create/resend: [`api/invites.js`](../api/invites.js)
