/**
 * One-time script: promote an existing pending profile to owner.
 *
 * Prerequisites:
 *   1. The target user must have already signed in at least once so that their
 *      profile exists in the database with approvalStatus = 'pending'.
 *   2. Set INSTANT_ADMIN_TOKEN and VITE_INSTANT_APP_ID in .env
 *
 * Usage:
 *   npx tsx scripts/seed-owner.ts owner@example.com
 */

import { init } from '@instantdb/admin';
import * as fs from 'fs';
import * as path from 'path';

// Read .env manually (tsx doesn't load .env automatically)
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
const ownerEmail = process.argv[2];

if (!APP_ID) throw new Error('VITE_INSTANT_APP_ID is not set in .env');
if (!ADMIN_TOKEN) throw new Error('INSTANT_ADMIN_TOKEN is not set in .env');
if (!ownerEmail) {
  console.error('Usage: npx tsx scripts/seed-owner.ts owner@example.com');
  process.exit(1);
}

const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

async function main() {
  console.log(`Looking up profile for ${ownerEmail}...`);

  const result = await db.query({
    profiles: {
      $: { where: { email: ownerEmail } },
    },
  });

  const profiles = result.profiles ?? [];

  if (profiles.length === 0) {
    console.error(
      `No profile found for ${ownerEmail}.\n` +
        'Make sure the user has signed in at least once so their profile is created.',
    );
    process.exit(1);
  }

  const profile = profiles[0];
  console.log(
    `Found profile: id=${profile.id} role=${profile.role} status=${profile.approvalStatus}`,
  );

  if (profile.approvalStatus === 'approved' && profile.role === 'owner') {
    console.log('Profile is already an approved owner. Nothing to do.');
    return;
  }

  await db.transact(
    // @ts-expect-error — admin SDK tx shape is the same as client
    db.tx.profiles[profile.id].update({
      role: 'owner',
      approvalStatus: 'approved',
      approvedAt: new Date().toISOString(),
      approvedByEmail: 'seed-owner-script',
      updatedAt: new Date().toISOString(),
    }),
  );

  console.log(`Done. ${ownerEmail} is now an approved owner.`);
  console.log('Open the app and sign in to verify.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
