/*
  What a barcode's text means. Nothing here touches the database.
*/

export const MAX_CODE = 100;

/* Trims and collapses spacing, the way a scanner or a person typing would leave it. */
export const cleanCode = raw => String(raw ?? '').trim().replace(/\s+/g, ' ');

/*
  The same product can come back as 12 digits (UPC-A) from one decoder and 13 (EAN-13, the same code with a
  0 in front) from another, so an all-digit code is compared without its leading zeros. Anything else is
  compared ignoring case.
*/
export const lookupKey = code => {
  const clean = cleanCode(code);
  return /^\d+$/.test(clean) ? clean.replace(/^0+/, '') || '0' : clean.toLowerCase();
};

/* The GS1 check digit that belongs after `digits` (a string of digits, without its own check digit). */
export const checkDigit = digits => {
  const sum = [...digits].reverse().reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
};

const GTIN_LENGTHS = [8, 12, 13, 14];

/*
  A UPC-E is a UPC-A squeezed to 8 digits (a number system of 0 or 1, six digits and the check digit), so its
  check digit is the one of the UPC-A it expands to, not of the eight digits as they stand.
*/
const expandUpcE = code => {
  const [system, a, b, c, d, e, f] = code;
  const body = {
    0: `${a}${b}${f}0000${c}${d}${e}`,
    1: `${a}${b}${f}0000${c}${d}${e}`,
    2: `${a}${b}${f}0000${c}${d}${e}`,
    3: `${a}${b}${c}00000${d}${e}`,
    4: `${a}${b}${c}${d}00000${e}`,
  }[f] ?? `${a}${b}${c}${d}${e}0000${f}`;
  return `${system}${body}`;
};

export const isUpcE = code => /^[01]\d{7}$/.test(code) && checkDigit(expandUpcE(code)) === Number(code.at(-1));

/* EAN-8, UPC-E, UPC-A (12), EAN-13 and GTIN-14 with a check digit that matches. */
export const isGtin = code => /^\d+$/.test(code) && GTIN_LENGTHS.includes(code.length) && (checkDigit(code.slice(0, -1)) === Number(code.at(-1)) || isUpcE(code));

export const kindOf = code => (isGtin(code) ? 'upc' : 'other');

/* A digits-only code of a GTIN length whose last digit is wrong: almost certainly a typing or reading mistake. */
export const looksMistyped = code => /^\d+$/.test(code) && GTIN_LENGTHS.includes(code.length) && !isGtin(code);

/*
  How a code is drawn. A real UPC or EAN is drawn as itself so the copy is the same symbol as the original;
  everything else is Code 128, which holds any text and is read by every scanner and phone camera.
*/
export const symbologyFor = code => {
  if(isGtin(code) && code.length === 12) return 'upca';
  if(isGtin(code) && code.length === 13) return 'ean13';
  if(isGtin(code) && code.length === 8) return checkDigit(code.slice(0, -1)) === Number(code.at(-1)) ? 'ean8' : 'upce';
  return 'code128';
};

export const cleanPrefix = raw => String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'INV';

export const formatInternal = (prefix, number) => `${cleanPrefix(prefix)}-${String(number).padStart(6, '0')}`;
