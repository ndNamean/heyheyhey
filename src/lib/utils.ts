export function nowText(): string {
  return new Date().toLocaleString('en-GB', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function badgeClass(status: string): string {
  if (status === 'approved' || status === 'verified') return 'badge good';
  if (['rejected', 'missed', 'late', 'overdue'].includes(status)) return 'badge bad';
  if (['waiting_approval', 'need_correction', 'pending', 'open', 'in_progress'].includes(status))
    return 'badge warn';
  return 'badge';
}

export function calcCompletion(items: { ticked: boolean; required: boolean }[]): number {
  const required = items.filter((i) => i.required);
  if (!required.length) return 100;
  return Math.round((required.filter((i) => i.ticked).length / required.length) * 100);
}

export function calcCompliance(
  items: { ticked: boolean; required: boolean; status: string }[],
): number {
  const reviewed = items.filter((i) => i.required && ['approved', 'rejected'].includes(i.status));
  if (!reviewed.length) return 100;
  return Math.round(
    (reviewed.filter((i) => i.status === 'approved').length / reviewed.length) * 100,
  );
}

// Generate a photo code like HP-VO-20260630-A7K2
export function generatePhotoCode(storeCode: string): string {
  const date = todayYmd().replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `HP-${storeCode}-${date}-${rand}`;
}
