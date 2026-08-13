import { describe, it, expect } from 'vitest';
import { resolveVenue } from '../utils/resolveEvent';

const site = {
  name: 'Camp Onas',
  address: '1100 Blooming Glen Rd',
  phone: '215-555-0000',
  accessibilityNote: 'Partially accessible',
  image: '/images/camp-onas.jpg',
};

describe('resolveVenue', () => {
  it('uses event fields when all are provided', () => {
    const result = resolveVenue(
      {
        location: 'Custom Hall',
        address: '42 Main St',
        phone: '888-000-0000',
        accessibilityNote: 'Fully accessible',
        image: '/images/custom.jpg',
      },
      site
    );
    expect(result).toEqual({
      location: 'Custom Hall',
      address: '42 Main St',
      phone: '888-000-0000',
      accessibilityNote: 'Fully accessible',
      image: '/images/custom.jpg',
    });
  });

  it('falls back to site fields when event fields are absent', () => {
    const result = resolveVenue({}, site);
    expect(result).toEqual({
      location: 'Camp Onas',
      address: '1100 Blooming Glen Rd',
      phone: '215-555-0000',
      accessibilityNote: 'Partially accessible',
      image: '/images/camp-onas.jpg',
    });
  });

  it('uses event.location when provided, ignores site.name', () => {
    const result = resolveVenue({ location: 'Override Location' }, site);
    expect(result.location).toBe('Override Location');
  });

  it('falls back to empty string when neither event.location nor site.name exist', () => {
    const result = resolveVenue({});
    expect(result.location).toBe('');
  });

  it('returns undefined for optional fields when neither event nor site provide them', () => {
    const result = resolveVenue({ location: 'Somewhere' });
    expect(result.address).toBeUndefined();
    expect(result.phone).toBeUndefined();
    expect(result.accessibilityNote).toBeUndefined();
    expect(result.image).toBeUndefined();
  });

  it('mixes event and site fields — event wins per field', () => {
    const result = resolveVenue({ address: 'Custom Address' }, site);
    expect(result.address).toBe('Custom Address');
    expect(result.phone).toBe('215-555-0000');
    expect(result.image).toBe('/images/camp-onas.jpg');
  });

  // The CMS writes '' for every optional field left blank, so empty strings must
  // fall through to the site data. Regression: `??` let '' win, and the Fun Day
  // page rendered a bare "Location" label and a `· —` title.
  it('treats empty-string event fields as absent and falls back to the site', () => {
    const result = resolveVenue({ location: '', address: '', phone: '', accessibilityNote: '', image: '' }, site);
    expect(result).toEqual({
      location: 'Camp Onas',
      address: '1100 Blooming Glen Rd',
      phone: '215-555-0000',
      accessibilityNote: 'Partially accessible',
      image: '/images/camp-onas.jpg',
    });
  });

  it('keeps lat/lng of 0 rather than falling back to the site', () => {
    const result = resolveVenue({ lat: 0, lng: 0 }, { ...site, lat: 39.7, lng: -75.6 });
    expect(result.lat).toBe(0);
    expect(result.lng).toBe(0);
  });

  it('works with no site argument', () => {
    const result = resolveVenue({ location: 'Solo Venue', address: '1 Elm St' });
    expect(result.location).toBe('Solo Venue');
    expect(result.address).toBe('1 Elm St');
  });
});
