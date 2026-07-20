import { describe, expect, it } from 'vitest';
import {
  MAX_ADDRESS_LINES,
  MAX_STAMP_HEIGHT_RATIO,
  MAX_WEATHER_LINES,
  buildTaggedDetailLines,
  compositionHeight,
  fitTaggedDetailLines,
  stampHeightBudget,
  taggedTexts,
} from './proofStampFit';

describe('stampHeightBudget', () => {
  it('caps composition to ratio of frame height', () => {
    const budget = stampHeightBudget(1000, 20);
    expect(budget).toBe(1000 * MAX_STAMP_HEIGHT_RATIO);
  });

  it('never exceeds frame minus margins', () => {
    const budget = stampHeightBudget(100, 40);
    expect(budget).toBe(20);
  });
});

describe('buildTaggedDetailLines', () => {
  it('caps address and weather line counts', () => {
    const address = ['a1', 'a2', 'a3', 'a4', 'a5'];
    const weather = ['w1', 'w2', 'w3'];
    const tagged = buildTaggedDetailLines(address, weather);
    expect(tagged.filter((l) => l.kind === 'address')).toHaveLength(MAX_ADDRESS_LINES);
    expect(tagged.filter((l) => l.kind === 'weather')).toHaveLength(MAX_WEATHER_LINES);
  });
});

describe('fitTaggedDetailLines', () => {
  it('drops weather before address when over height budget', () => {
    const lines = buildTaggedDetailLines(
      ['addr line 1', 'addr line 2', 'addr line 3'],
      ['weather 1', 'weather 2'],
    );
    const lineHeight = 20;
    const zoneGap = 8;
    const primary = 80;
    // Budget that fits primary + zoneGap + 3 detail lines only.
    const maxH = compositionHeight(primary, 3, lineHeight, zoneGap);
    const fitted = fitTaggedDetailLines(lines, lineHeight, zoneGap, primary, maxH);
    expect(fitted.every((l) => l.kind === 'address')).toBe(true);
    expect(fitted).toHaveLength(3);
    expect(compositionHeight(primary, fitted.length, lineHeight, zoneGap)).toBeLessThanOrEqual(maxH);
  });

  it('keeps all lines when under budget', () => {
    const lines = buildTaggedDetailLines(['a1'], ['w1']);
    const fitted = fitTaggedDetailLines(lines, 16, 8, 40, 400);
    expect(taggedTexts(fitted)).toEqual(['a1', 'w1']);
  });

  it('can drop all detail lines if primary alone fills budget', () => {
    const lines = buildTaggedDetailLines(['a1', 'a2'], ['w1']);
    const fitted = fitTaggedDetailLines(lines, 20, 8, 100, 100);
    expect(fitted).toHaveLength(0);
  });
});
