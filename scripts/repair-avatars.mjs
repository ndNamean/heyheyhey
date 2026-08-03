/**
 * One-shot: relink profiles to existing profile-avatars/* $files.
 * Usage: node scripts/repair-avatars.mjs
 * Env: INSTANT_APP_ID / VITE_INSTANT_APP_ID, INSTANT_ADMIN_TOKEN
 */

import { init } from '@instantdb/admin';

const APP_ID =
  process.env.VITE_INSTANT_APP_ID ||
  process.env.INSTANT_APP_ID ||
  'f7ac027e-2079-41eb-8f34-aa0e4543ca71';
const ADMIN_TOKEN =
  process.env.INSTANT_ADMIN_TOKEN ||
  process.env.INSTANT_APP_ADMIN_TOKEN ||
  process.env.INSTANT_CLI_AUTH_TOKEN ||
  '';

const AVATAR_EXTS = ['png', 'jpg', 'webp'];

if (!ADMIN_TOKEN) {
  console.error('Missing INSTANT_ADMIN_TOKEN');
  process.exit(1);
}

const adminDb = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

function storageAvatarPath(userId, ext) {
  return `profile-avatars/${userId}/avatar.${ext}`;
}

async function collectAvatarFiles(userId) {
  const files = [];
  for (const ext of AVATAR_EXTS) {
    const pathTry = storageAvatarPath(userId, ext);
    const q = await adminDb.query({
      $files: { $: { where: { path: pathTry } } },
    });
    if (q?.$files?.[0]) files.push(q.$files[0]);
  }
  return files;
}

async function repairProfile(profile) {
  const linkedUrl = profile.avatarFile?.url?.trim() || '';
  const linkedId = profile.avatarFile?.id || null;
  if (linkedUrl && linkedId) {
    return 'alreadyOk';
  }

  const files = await collectAvatarFiles(profile.userId);
  const preferredPath = profile.avatarPath?.trim() || '';
  const file =
    (preferredPath && files.find((f) => f.path === preferredPath)) ||
    files.find((f) => f.url) ||
    files[0] ||
    null;

  if (!file?.id) return 'missing';

  const txs = [];
  if (linkedId && linkedId !== file.id) {
    txs.push(adminDb.tx.profiles[profile.id].unlink({ avatarFile: linkedId }));
  }
  txs.push(
    adminDb.tx.profiles[profile.id]
      .update({
        avatarPath: file.path || preferredPath || '',
        avatarUrl: '',
        updatedAt: new Date().toISOString(),
      })
      .link({ avatarFile: file.id }),
  );
  await adminDb.transact(txs);
  return 'repaired';
}

const { profiles = [] } = await adminDb.query({
  profiles: { avatarFile: {} },
});

let repaired = 0;
let alreadyOk = 0;
let missing = 0;
const errors = [];

for (const profile of profiles) {
  try {
    const status = await repairProfile(profile);
    if (status === 'repaired') repaired++;
    else if (status === 'alreadyOk') alreadyOk++;
    else missing++;
  } catch (e) {
    errors.push({ userId: profile.userId, error: String(e?.message || e) });
  }
}

console.log(
  JSON.stringify(
    { scanned: profiles.length, repaired, alreadyOk, missing, errors },
    null,
    2,
  ),
);
