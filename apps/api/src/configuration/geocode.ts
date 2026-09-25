import { BadGatewayException, BadRequestException } from '@nestjs/common';

export interface GeocodeHit {
  latitude: number;
  longitude: number;
  /** The place as the map service names it, for the owner to recognise. */
  label: string;
}

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

/**
 * Find an address on the map (Hotel Profile → "Find the address on the map", owner brief of
 * 2026-09-21 and 2026-09-26). OpenStreetMap's Nominatim needs no key, so the map works without a
 * Google Maps account; its usage policy asks for an identifying User-Agent and at most one request
 * a second, which an owner typing an address never approaches. Called from the API, never the
 * browser, so the hotel's visitors are not sent to a third party.
 */
export async function geocodeAddress(
  query: string,
  country?: string | null,
): Promise<GeocodeHit[]> {
  const q = query.trim();
  if (q.length < 3) throw new BadRequestException('Type more of the address to look it up');
  const url = new URL(ENDPOINT);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  if (country) url.searchParams.set('countrycodes', country.toLowerCase());
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'YoHoBed-PMS/2.0 (hotel profile address lookup; https://yova.markui.lk)',
        'Accept-Language': 'en',
      },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new BadGatewayException('The map service did not answer. Try again in a moment.');
  }
  if (!res.ok) throw new BadGatewayException('The map service could not look that up right now.');
  const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  return rows
    .map((r) => ({
      latitude: Number(r.lat),
      longitude: Number(r.lon),
      label: r.display_name,
    }))
    .filter((h) => Number.isFinite(h.latitude) && Number.isFinite(h.longitude));
}
