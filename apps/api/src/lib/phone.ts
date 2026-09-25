import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Normaliza un teléfono escrito por una persona ("41 99876-5432", "+55 (41) 99876-5432"…) a E.164
 * (+5541998765432) usando el código de país del negocio cuando el número no lo trae.
 * Devuelve null si no es un número válido.
 */
export function toE164(raw: string, defaultCountryCode: string): string | null {
  const text = raw.trim();
  if (!text || text.length > 40) return null;
  const withPlus = text.startsWith('00') ? `+${text.slice(2)}` : text;
  try {
    const parsed = parsePhoneNumberFromString(withPlus, { defaultCallingCode: defaultCountryCode });
    if (!parsed || !parsed.isValid()) return null;
    return parsed.number;
  } catch {
    // libphonenumber lanza con un código de país que no existe (p. ej. 999): es un teléfono no válido.
    return null;
  }
}
