import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parseMysqlDump } from '../src/dump-schema';
import { buildReport } from '../src/discover';

/**
 * The dump parser is how a `mysqldump --no-data` becomes a schema we can check the contract
 * against — no MySQL server, no credentials, no production access. So it has to be right about
 * MySQL DDL specifically, and the failure modes that matter are all about *silently* mis-reading:
 * a comma inside an ENUM ending a column list early, a `)` inside a default closing a table.
 */

describe('mysql dump parser', () => {
  it('reads table and column names with types and nullability', () => {
    const { schema } = parseMysqlDump(`
      CREATE TABLE IF NOT EXISTS \`rooms\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`display_name\` VARCHAR(255) DEFAULT NULL,
        \`quantity\` INT NOT NULL DEFAULT 1,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    const rooms = schema.get('rooms')!;
    expect([...rooms.keys()]).toEqual(['id', 'display_name', 'quantity']);
    expect(rooms.get('id')).toEqual({ type: 'INT', nullable: false });
    expect(rooms.get('display_name')).toEqual({ type: 'VARCHAR(255)', nullable: true });
    expect(rooms.get('quantity')!.nullable).toBe(false);
  });

  it('keeps DECIMAL precision intact — the comma must not split the column', () => {
    const { schema } = parseMysqlDump(
      'CREATE TABLE `bookings` (`amount` DECIMAL(12,2) DEFAULT 0.00, `taxes` DECIMAL(10,2));',
    );
    const t = schema.get('bookings')!;
    expect(t.get('amount')!.type).toBe('DECIMAL(12,2)');
    expect(t.get('taxes')!.type).toBe('DECIMAL(10,2)');
    expect([...t.keys()]).toEqual(['amount', 'taxes']);
  });

  it('survives commas and parens inside an ENUM — the real-world trap', () => {
    // The legacy bookings table has exactly this: an ENUM whose members contain spaces and commas.
    const { schema } = parseMysqlDump(`
      CREATE TABLE \`bookings\` (
        \`cancellation_reason\` ENUM('-','No show by Customer','No availability, at all','Paid (partly)') NOT NULL DEFAULT '-',
        \`status\` ENUM('Approved','Pending') NOT NULL DEFAULT 'Pending',
        \`rooms\` INT DEFAULT 1
      );
    `);
    const t = schema.get('bookings')!;
    expect([...t.keys()]).toEqual(['cancellation_reason', 'status', 'rooms']);
    expect(t.get('cancellation_reason')!.type).toContain('No availability, at all');
    expect(t.get('rooms')!.type).toBe('INT');
  });

  it('ignores keys, constraints and indexes — they are not columns', () => {
    const { schema } = parseMysqlDump(`
      CREATE TABLE \`bookings\` (
        \`id\` INT NOT NULL,
        \`room_id\` INT NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_booking_reference\` (\`reference\`),
        KEY \`fk_bk_room\` (\`room_id\`),
        CONSTRAINT \`fk_bk_room\` FOREIGN KEY (\`room_id\`) REFERENCES \`rooms\` (\`id\`)
      );
    `);
    expect([...schema.get('bookings')!.keys()]).toEqual(['id', 'room_id']);
  });

  it('handles a db-qualified table name and unquoted identifiers', () => {
    const { schema } = parseMysqlDump(
      'CREATE TABLE `armyoftheload`.`customers` (id INT NOT NULL, mobile VARCHAR(30));',
    );
    expect(schema.has('customers')).toBe(true);
    expect([...schema.get('customers')!.keys()]).toEqual(['id', 'mobile']);
  });

  it('reads every table in a multi-table dump', () => {
    const { schema, tables } = parseMysqlDump(`
      CREATE TABLE \`a\` (\`x\` INT);
      INSERT INTO \`a\` VALUES (1),(2);
      CREATE TABLE \`b\` (\`y\` INT);
    `);
    expect(tables).toEqual(['a', 'b']);
    expect(schema.size).toBe(2);
  });

  it('skips a truncated table rather than emitting half its columns', () => {
    // A dump cut off mid-statement must not look like a table with fewer columns — that would
    // read as "the column is missing" and send someone hunting a schema change that never happened.
    const { schema } = parseMysqlDump(
      'CREATE TABLE `good` (`x` INT);\nCREATE TABLE `bad` (`y` INT',
    );
    expect(schema.has('good')).toBe(true);
    expect(schema.has('bad')).toBe(false);
  });

  it('treats a column as nullable unless NOT NULL is declared', () => {
    const { schema } = parseMysqlDump(
      'CREATE TABLE `t` (`a` INT NULL, `b` INT, `c` INT NOT NULL);',
    );
    const t = schema.get('t')!;
    expect(t.get('a')!.nullable).toBe(true);
    expect(t.get('b')!.nullable).toBe(true);
    expect(t.get('c')!.nullable).toBe(false);
  });

  it('reports no tables for a data-only or empty file, so the CLI can say why', () => {
    expect(parseMysqlDump('INSERT INTO `a` VALUES (1);').schema.size).toBe(0);
    expect(parseMysqlDump('').schema.size).toBe(0);
  });
});

/**
 * End-to-end against the reconstruction actually committed in the repo tree. This is not a
 * hypothetical fixture — it is the file the ETL was nearly written against, and pinning what
 * discovery says about it keeps the "the dump is unreliable" finding from quietly rotting.
 */
describe('against backend-portal/database.sql (the reconstruction)', () => {
  const DUMP = 'd:/YoHo Application/backend-portal/database.sql';

  it.skipIf(!existsSync(DUMP))('parses all 114 tables and flags the known gaps', () => {
    const { schema, tables } = parseMysqlDump(readFileSync(DUMP, 'utf8'));
    expect(tables.length).toBe(114);

    const report = buildReport(schema, new Map(), 'reconstruction', '2026-07-28T00:00:00.000Z');

    // It must NOT clear a cutover: selling_price is absent entirely, which is the whole point.
    expect(report.canProceed).toBe(false);
    const sellingPrice = report.tables.find((t) => t.table === 'selling_price')!;
    expect(sellingPrice.status).toBe('missing');

    // And occupancies.accomadates — which legacy queries as a real SQL column — is not there
    // either, so this reconstruction disagrees with the running code in at least two places.
    const occupancies = report.tables.find((t) => t.table === 'occupancies')!;
    expect(occupancies.columns.find((c) => c.column === 'accomadates')!.status).toBe('missing');

    // The tenancy spine and the pricing key ARE present — those we can rely on.
    const props = report.tables.find((t) => t.table === 'properties')!;
    expect(props.columns.find((c) => c.column === 'propertyowner_id')!.status).toBe('ok');
    expect(props.columns.find((c) => c.column === 'pricing_type')!.status).toBe('ok');
    const orp = report.tables.find((t) => t.table === 'occupancy_rateplan')!;
    expect(orp.columns.every((c) => c.status === 'ok')).toBe(true);
  });
});
