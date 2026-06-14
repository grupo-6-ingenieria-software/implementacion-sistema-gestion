export function normalizeEan13(value: string): string {
  return value.replace(/\D/g, '').slice(0, 13);
}

export function isValidEan13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) {
    return false;
  }

  // Validacion del digito verificador (mod 10) sobre los primeros 12 digitos:
  // posiciones impares (indice par, 0-based) x1 y posiciones pares (indice impar) x3.
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const digit = value.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? digit : digit * 3;
  }

  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === value.charCodeAt(12) - 48;
}
