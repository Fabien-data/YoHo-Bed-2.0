/** The list of night dates (YYYY-MM-DD) for a stay: [checkin, checkout). */
export function eachNight(checkin: string, checkout: string): string[] {
  const nights: string[] = [];
  const end = new Date(`${checkout}T00:00:00Z`);
  for (let d = new Date(`${checkin}T00:00:00Z`); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
    nights.push(d.toISOString().slice(0, 10));
  }
  return nights;
}

/** Every date (YYYY-MM-DD) in the inclusive range [from, to]. */
export function dateRangeInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = new Date(`${from}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
