import type { LangCode } from '../i18n';

type LocalizedMap = Partial<Record<LangCode, string>> & Record<string, string | undefined>;

export function getLocalizedText(
  value: string | LocalizedMap | null | undefined,
  lang: LangCode,
  fallback?: LangCode,
): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[lang] ?? value[fallback ?? 'en'] ?? value.en ?? Object.values(value).find(Boolean) ?? '';
}

export function statusKey(status: string): string {
  return status.replace(/-/g, '_');
}

export function statusLabel(t: { status: Record<string, string> }, status: string): string {
  const key = statusKey(status);
  return t.status[key] ?? status.replace(/_/g, ' ');
}
