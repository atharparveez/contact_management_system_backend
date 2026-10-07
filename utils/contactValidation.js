// utils/contactValidation.js
import dns from "node:dns";
import { isValidPhoneNumber, parsePhoneNumberFromString } from "libphonenumber-js";
import countries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json" with { type: "json" };

countries.registerLocale(enLocale);

// The "Country" form field is free text (see ContactFormFields.jsx), not a
// proper ISO selector, so casual/short forms people actually type need to
// resolve too -- i18n-iso-countries only recognizes official English names.
const COUNTRY_ALIASES = {
  usa: "US",
  "u.s.a": "US",
  "u.s.a.": "US",
  "united states": "US",
  "united states of america": "US",
  uk: "GB",
  "u.k.": "GB",
  "united kingdom": "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  uae: "AE",
  "u.a.e": "AE",
  "u.a.e.": "AE",
};

export function resolveCountryCode(countryName) {
  if (!countryName) return null;
  const trimmed = countryName.trim();
  if (!trimmed) return null;

  const alias = COUNTRY_ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;

  if (/^[a-z]{2}$/i.test(trimmed) && countries.isValid(trimmed.toUpperCase())) {
    return trimmed.toUpperCase();
  }

  return countries.getAlpha2Code(trimmed, "en") || null;
}

// A number already in international format (+<country code>...) can be
// validated on its own; anything else needs the contact's own country field
// resolved to a region so libphonenumber knows which numbering plan to use.
export function isPhoneValid(phone, countryName) {
  if (!phone || !phone.trim()) return true;
  const trimmed = phone.trim();

  if (trimmed.startsWith("+")) {
    const parsed = parsePhoneNumberFromString(trimmed);
    return Boolean(parsed?.isValid());
  }

  const countryCode = resolveCountryCode(countryName);
  if (!countryCode) return false;
  return isValidPhoneNumber(trimmed, countryCode);
}

const mxCache = new Map();

// MX lookup, falling back to an A-record check -- RFC 5321 treats a domain
// with no MX but a valid A record as an implicit mail destination.
export async function hasMxRecord(email) {
  if (!email || !email.includes("@")) return false;
  const domain = email.split("@")[1]?.trim().toLowerCase();
  if (!domain) return false;

  if (mxCache.has(domain)) return mxCache.get(domain);

  const result = await (async () => {
    try {
      const records = await dns.promises.resolveMx(domain);
      if (records.length > 0) return true;
    } catch {
      // no MX record -- fall through to the A-record fallback below
    }
    try {
      await dns.promises.resolve(domain);
      return true;
    } catch {
      return false;
    }
  })();

  mxCache.set(domain, result);
  return result;
}
