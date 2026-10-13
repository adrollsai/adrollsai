/**
 * Phone number validation and sanitization utilities.
 */

/**
 * Checks whether a given phone number is an Indian phone number.
 * 
 * Rules for valid Indian numbers:
 * 1. E.164 with explicit +91: must have 10 digits following +91 (total 12 digits: 91XXXXXXXXXX)
 * 2. 12 digits starting with 91: 91 followed by 10 digits
 * 3. Standard 10-digit Indian mobile: starts with 6, 7, 8, or 9
 * 4. 11-digit domestic Indian number with leading 0: 0 followed by 10 digits starting with 6, 7, 8, or 9
 * 
 * Any international country code (e.g. UAE +971, Saudi +966, US +1, UK +44, etc.)
 * or format that does not match India (+91) will return false.
 */
export function isIndianPhoneNumber(phoneRaw: string | null | undefined): boolean {
  if (!phoneRaw) return false;
  const clean = String(phoneRaw).trim();
  if (!clean) return false;

  // 1. If explicit '+' prefix is present, verify it strictly belongs to India (+91)
  if (clean.startsWith('+')) {
    const digits = clean.replace(/\D/g, '');
    return digits.startsWith('91') && digits.length === 12;
  }

  // 2. Strip all non-digits
  let digits = clean.replace(/\D/g, '');

  // Strip international exit prefix '00' (e.g., 0091... or 00971...)
  if (digits.startsWith('00')) {
    digits = digits.substring(2);
  }

  // 3. Explicit country code 91 with 10 digits following (total 12 digits)
  if (digits.startsWith('91') && digits.length === 12) {
    return true;
  }

  // 4. Standard 10-digit Indian mobile starting with 6, 7, 8, 9
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    return true;
  }

  // 5. Domestic 11-digit Indian number starting with 0 followed by 6, 7, 8, 9
  if (digits.length === 11 && /^0[6-9]\d{9}$/.test(digits)) {
    return true;
  }

  return false;
}
