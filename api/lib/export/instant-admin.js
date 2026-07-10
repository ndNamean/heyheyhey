/**
 * Shared InstantDB Admin SDK init for export routes.
 */

import { init } from '@instantdb/admin';

const DEFAULT_APP_ID = 'f7ac027e-2079-41eb-8f34-aa0e4543ca71';

export function getCredentials() {
  const appId =
    process.env.VITE_INSTANT_APP_ID ||
    process.env.INSTANT_APP_ID ||
    DEFAULT_APP_ID;

  const adminToken =
    process.env.INSTANT_ADMIN_TOKEN ||
    process.env.INSTANT_APP_ADMIN_TOKEN ||
    process.env.INSTANT_CLI_AUTH_TOKEN ||
    '';

  if (!adminToken) {
    throw new Error('Missing INSTANT_ADMIN_TOKEN');
  }

  return { appId, adminToken };
}

export function getAdminDb() {
  const { appId, adminToken } = getCredentials();
  return init({ appId, adminToken });
}

export function parseBody(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

export function extractBearerToken(req) {
  const authHeader = req.headers['authorization'] || req.headers['token'];
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!raw) return null;
  if (raw.startsWith('Bearer ')) return raw.slice(7).trim();
  return raw.trim();
}

export function verifyCronSecret(req) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true;
  const authHeader = req.headers['authorization'];
  const token = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  return token === `Bearer ${cronSecret}`;
}
