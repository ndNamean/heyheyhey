export function shouldKeepHeaderOneRow(label: string): boolean {
  const trimmed = label.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return false;
  return trimmed.replace(/\s+/g, '').length < 13;
}
