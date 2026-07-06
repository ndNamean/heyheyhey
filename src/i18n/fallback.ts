type Dict = Record<string, unknown>;

export function deepMerge<T extends Dict>(base: T, override: Dict): T {
  const out = { ...base } as Dict;
  for (const key of Object.keys(override)) {
    const bv = base[key];
    const ov = override[key];
    if (
      ov !== null &&
      typeof ov === 'object' &&
      !Array.isArray(ov) &&
      bv !== null &&
      typeof bv === 'object' &&
      !Array.isArray(bv)
    ) {
      out[key] = deepMerge(bv as Dict, ov as Dict);
    } else if (ov !== undefined) {
      out[key] = ov;
    }
  }
  return out as T;
}
