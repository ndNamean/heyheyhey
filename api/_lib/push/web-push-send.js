/**
 * Standards-based Web Push send helper (VAPID).
 * Private key stays server-side only.
 */

import webpush from 'web-push';

let configuredSubject = null;

export function getVapidConfig() {
  const publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = String(process.env.VAPID_SUBJECT || '').trim();
  if (!publicKey || !privateKey || !subject) {
    const err = new Error(
      'Missing VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, or VAPID_SUBJECT',
    );
    err.status = 500;
    throw err;
  }
  return { publicKey, privateKey, subject };
}

function ensureVapidConfigured() {
  const cfg = getVapidConfig();
  if (configuredSubject !== cfg.subject) {
    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    configuredSubject = cfg.subject;
  }
  return cfg;
}

/**
 * @param {{ endpoint: string, p256dh: string, auth: string }} subscription
 * @param {{ title: string, body: string, url?: string, tag?: string }} payload
 */
export async function sendWebPush(subscription, payload) {
  ensureVapidConfigured();
  const pushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
  };
  const body = JSON.stringify({
    title: payload.title || 'Notification',
    body: payload.body || '',
    url: payload.url || '/',
    tag: payload.tag || undefined,
  });

  try {
    await webpush.sendNotification(pushSubscription, body, {
      TTL: 60 * 60,
      urgency: 'normal',
    });
    return { ok: true };
  } catch (e) {
    const statusCode = e?.statusCode || e?.status || 0;
    return {
      ok: false,
      statusCode,
      gone: statusCode === 404 || statusCode === 410,
      error: e instanceof Error ? e.message : 'Push send failed',
    };
  }
}

export function isWebPushConfigured() {
  try {
    getVapidConfig();
    return true;
  } catch {
    return false;
  }
}
