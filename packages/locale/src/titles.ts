/**
 * Salutations for the guest name field.
 *
 * The common set works everywhere. Each home market adds the forms of address its front desks
 * actually use — getting a Datuk's or a Venerable's title wrong on a registration card is a real
 * service failure in those markets, not a cosmetic one.
 */

const COMMON = ['Mr.', 'Mrs.', 'Ms.', 'Miss', 'Master', 'Dr.', 'Prof.', 'Rev.'];

const BY_COUNTRY: Record<string, string[]> = {
  // Venerable for Buddhist clergy; Honourable for ministers and MPs.
  LK: ['Ven.', 'Hon.'],
  // Federal and state honorifics, the pilgrimage titles, and the everyday Malay forms.
  MY: [
    'Tun',
    'Toh Puan',
    'Tan Sri',
    'Puan Sri',
    'Datuk Seri',
    "Dato' Sri",
    'Datuk',
    "Dato'",
    'Datin Paduka',
    'Datin',
    'Tengku',
    'Tunku',
    'Haji',
    'Hajjah',
    'Encik',
    'Puan',
    'Cik',
  ],
  IN: ['Shri', 'Smt.', 'Kumari'],
};

/** The title list for a property's country: common forms first, then the local ones. */
export function titlesFor(country: string | null | undefined): string[] {
  const local = (country && BY_COUNTRY[country]) || [];
  return [...COMMON, ...local];
}

/** Every known title — for validating a stored value regardless of the property's country. */
export function allTitles(): string[] {
  return [...COMMON, ...Object.values(BY_COUNTRY).flat()];
}
