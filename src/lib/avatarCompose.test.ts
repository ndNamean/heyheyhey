import { describe, expect, it } from 'vitest';
import {
  pickBestContrastPreset,
  profileInitials,
  rightThirdOccupancy,
  sampleAverageLuminance,
} from './avatarCompose';

describe('profileInitials', () => {
  it('uses two letters for multi-word names', () => {
    expect(profileInitials('Jane Doe', 'j@x.com')).toBe('JD');
  });
  it('falls back to first character', () => {
    expect(profileInitials('Alice', '')).toBe('A');
  });
  it('uses email when name empty', () => {
    expect(profileInitials('', 'bob@x.com')).toBe('B');
  });
});

describe('pickBestContrastPreset', () => {
  it('picks brighter accents for dark portraits', () => {
    expect(pickBestContrastPreset(40)).toBe('cyberpunk');
  });
  it('picks darker tones for bright portraits', () => {
    expect(pickBestContrastPreset(210)).toBe('moody_monochrome');
  });
});

describe('sampleAverageLuminance / rightThirdOccupancy', () => {
  it('ignores transparent pixels for luminance', () => {
    const data = new Uint8ClampedArray(8);
    // opaque white
    data[0] = 255;
    data[1] = 255;
    data[2] = 255;
    data[3] = 255;
    // transparent black
    data[4] = 0;
    data[5] = 0;
    data[6] = 0;
    data[7] = 0;
    const imageData = { data, width: 2, height: 1 } as ImageData;
    expect(sampleAverageLuminance(imageData)).toBeGreaterThan(250);
  });

  it('measures right-third occupancy', () => {
    // 3x1: left two transparent, right opaque
    const data = new Uint8ClampedArray(12);
    data[8] = 10;
    data[9] = 10;
    data[10] = 10;
    data[11] = 255;
    const imageData = { data, width: 3, height: 1 } as ImageData;
    expect(rightThirdOccupancy(imageData)).toBe(1);
  });
});
