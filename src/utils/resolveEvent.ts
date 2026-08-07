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
  return {
    location: event.location ?? site?.name ?? '',
    address: event.address ?? site?.address,
    phone: event.phone ?? site?.phone,
    accessibilityNote: event.accessibilityNote ?? site?.accessibilityNote,
    image: event.image ?? site?.image,
    lat: event.lat ?? site?.lat,
    lng: event.lng ?? site?.lng,
  };
}
