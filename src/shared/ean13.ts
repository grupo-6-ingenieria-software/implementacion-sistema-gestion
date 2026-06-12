export function normalizeEan13(value: string): string {
  return value.replace(/\D/g, '').slice(0, 13);
}

export function isValidEan13(value: string): boolean {
  return /^\d{13}$/.test(value);
}
