/**
 * Deactivate Wi-Fi notify session before Instant sign-out.
 */

import { db } from '../db';
import { getOrCreateWifiNotifyDeviceId } from './deviceId';
import { deactivateWifiNotify } from './pushClient';

export async function deactivateWifiNotifyOnLogout(): Promise<void> {
  try {
    await deactivateWifiNotify(getOrCreateWifiNotifyDeviceId(), 'logout');
  } catch {
    /* still allow sign-out */
  }
}

export async function signOutWithWifiDeactivate(): Promise<void> {
  await deactivateWifiNotifyOnLogout();
  await db.auth.signOut();
}
