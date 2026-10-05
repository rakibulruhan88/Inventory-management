export function normalizeCode(value: string) {
  return value.trim().replace(/\s+/g, '').toUpperCase();
}

export function normalizeText(value?: string) {
  return value?.trim().replace(/\s+/g, ' ') ?? '';
}
