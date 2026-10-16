interface SiteData {
  name: string;
  address?: string;
  phone?: string;
  accessibilityNote?: string;
  image?: string;
  lat?: number;
  lng?: number;
}

export interface ResolvedVenue {
  location: string;
  address?: string;
  phone?: string;
  accessibilityNote?: string;
  image?: string;
  lat?: number;
  lng?: number;
}

export function resolveVenue(
  event: {
    location?: string;
    address?: string;
    phone?: string;
    accessibilityNote?: string;
    image?: string;
    lat?: number;
    lng?: number;
  },
  site?: SiteData
): ResolvedVenue {
  // `||`, not `??`, for the string fields: the CMS writes `''` for every optional
  // field left blank, and an empty string must fall through to the site data rather
  // than override it. lat/lng keep `??` — 0 is a valid coordinate.
  return {
    location: event.location || site?.name || '',
    address: event.address || site?.address,
    phone: event.phone || site?.phone,
    accessibilityNote: event.accessibilityNote || site?.accessibilityNote,
    image: event.image || site?.image,
    lat: event.lat ?? site?.lat,
    lng: event.lng ?? site?.lng,
  };
}

/**
 * Split a free-text phone field into the dialable number and any note around it,
 * e.g. "607-962-0541 (on-site, Dec 27 to Jan 1 only)" →
 * { number: "607-962-0541", tel: "6079620541", note: "on-site, Dec 27 to Jan 1 only" }.
 * Text with no recognisable number comes back as a note with no `tel`.
 */
export function splitPhone(phone: string): { number?: string; tel?: string; note?: string } {
  const match = phone.match(/\+?\(?\d[\d().\s-]{5,}\d/);
  if (!match) return { note: phone.trim() || undefined };
  const number = match[0].trim();
  const note = phone
    .replace(match[0], ' ')
    .replace(/\(\s*\)/g, ' ')
    .trim()
    .replace(/^[\s(:,-]+|[\s),:-]+$/g, '')
    .trim();
  return { number, tel: number.replace(/[^\d+]/g, ''), note: note || undefined };
}
