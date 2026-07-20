import { useDeviceLayoutOrientation } from './useDeviceLayoutOrientation';
import type { LayoutOrientation } from '../lib/cameraMediaTransform';

export type { DeviceLayoutOrientation, TiltSource } from './useDeviceLayoutOrientation';
export { useDeviceLayoutOrientation } from './useDeviceLayoutOrientation';

/**
 * Hybrid tilt (viewport + sensor). Returns orientation string only.
 * Prefer useDeviceLayoutOrientation when tiltSource / compactLandscape are needed.
 */
export function useLayoutOrientation(enabled = true): LayoutOrientation {
  return useDeviceLayoutOrientation(enabled).layoutOrientation;
}
