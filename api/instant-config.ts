/**
 * Resolve InstantDB credentials for Vercel serverless functions.
 *
 * VITE_* vars are build-time for the browser bundle and are often NOT available
 * to /api routes unless explicitly set in Vercel env. We fall back to
 * INSTANT_APP_ID and instant.config.json (public app id).
 */

const DEFAULT_APP_ID = 'f7ac027e-2079-41eb-8f34-aa0e4543ca71';

export function getInstantCredentials(): { appId: string; adminToken: string } {
  const appId =
    process.env.VITE_INSTANT_APP_ID ||
    process.env.INSTANT_APP_ID ||
    DEFAULT_APP_ID;

  const adminToken =
    process.env.INSTANT_ADMIN_TOKEN ||
    process.env.INSTANT_APP_ADMIN_TOKEN ||
    process.env.INSTANT_CLI_AUTH_TOKEN ||
    '';

  return { appId, adminToken };
}

export function requireInstantCredentials(): { appId: string; adminToken: string } {
  const creds = getInstantCredentials();
  if (!creds.appId) {
    throw new Error('Missing Instant app ID');
  }
  if (!creds.adminToken) {
    throw new Error(
      'Missing INSTANT_ADMIN_TOKEN. Add it in Vercel → Settings → Environment Variables.',
    );
  }
  return creds;
}
