/**
 * @yohobed/locale — regional reference data and formatters.
 *
 * Kept out of @yohobed/domain on purpose: the domain package is the float-parity pricing core and
 * stays dependency-free, while this package carries a phone-number library and a lot of plain data.
 * Nothing in here affects money.
 */

export * from './countries';
export * from './subdivisions';
export * from './titles';
export * from './id-documents';
export * from './meal-codes';
export * from './format';
export * from './presets';
