/**
 * Audit profiles missing the profiles ↔ $users link required by Instant
 * auth.ref('$user.profile.*') permission rules.
 *
 * Usage:
 *   npx tsx scripts/audit-profile-auth-links.ts
 *
 * Requires INSTANT_ADMIN_TOKEN and VITE_INSTANT_APP_ID in .env
 */

import { init } from '@instantdb/admin';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length && !key.startsWith('#')) {
      process.env[key.trim()] = rest.join('=').trim();
    }
  }
}

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

if (!APP_ID) throw new Error('VITE_INSTANT_APP_ID is not set in .env');
if (!ADMIN_TOKEN) throw new Error('INSTANT_ADMIN_TOKEN is not set in .env');

const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

async function main() {
  const result = await db.query({
    profiles: { $user: {} },
  });

  const profiles = result.profiles ?? [];
  const missing = profiles.filter((p) => !p.$user?.id && p.userId);
  const linked = profiles.filter((p) => p.$user?.id);

  console.log(`Profiles total: ${profiles.length}`);
  console.log(`Linked to $user: ${linked.length}`);
  console.log(`Missing $user link: ${missing.length}`);

  if (missing.length) {
    console.log('\nMissing link (email / role / userId):');
    for (const p of missing) {
      console.log(`  - ${p.email || p.id}  role=${p.role}  userId=${p.userId}`);
    }
    console.log(
      '\nFix: sign in once after deploying AuthGate auto-link, or run seed-owner / invite accept flow.',
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
