/**
 * @yohobed/domain — framework-free domain rules (the parity core).
 *
 * Every exported function reproduces a specific piece of the legacy YoHoBed pricing engine
 * and cites its source `file:line`. These functions have no dependency on Nest, Drizzle, or
 * any I/O, so they are trivially unit-tested for numeric parity and reused by the API, the
 * background workers, the ETL parity harness, and the MCP tool surface.
 */

export * from './types';
export * from './currency';
export * from './rounding';
export * from './commission';
export * from './tax';
export * from './pricing';
export * from './finance';
export * from './commercial';
export * from './template';
