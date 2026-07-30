import type { SchemaMap } from './discover';

/**
 * Parse a MySQL schema dump (`mysqldump --no-data`) into the same shape `discover` gets from a live
 * `information_schema` query.
 *
 * WHY: schema validation does not need a running database — a dump is just DDL text. Reading it
 * directly means the moment a dump lands we can answer "does the real schema match our
 * assumptions?" with no server to install, no credentials in flight, and no production access. It
 * also makes the check reproducible and runnable in CI against a committed schema snapshot.
 *
 * This is a deliberately narrow parser: it extracts table names, column names, column types and
 * nullability, and ignores everything else (keys, constraints, engine options, inserts). Those are
 * the only facts the contract check needs. It is not a general SQL parser and does not try to be.
 */

interface Scan {
  /** Index just past the consumed text. */
  end: number;
  text: string;
}

/**
 * Read a balanced `(...)` group starting at `open` (which must point at the `(`).
 * String and comment awareness matters: an ENUM default like `'a,b'` or `')'` would otherwise
 * end the group early and silently truncate a table's column list.
 */
function readBalanced(sql: string, open: number): Scan | null {
  let depth = 0;
  let i = open;
  let quote: string | null = null;

  while (i < sql.length) {
    const ch = sql[i]!;

    if (quote) {
      // Inside a string: honour backslash escapes and doubled quotes ('' / ``).
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          i += 2;
          continue;
        }
        quote = null;
      }
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return { end: i + 1, text: sql.slice(open + 1, i) };
      i += 1;
      continue;
    }
    i += 1;
  }
  return null; // unbalanced — a truncated dump
}

/** Split a table body on commas that are at paren depth 0 and outside strings. */
function splitColumns(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (quote) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) {
        if (body[i + 1] === quote) {
          i += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Definitions that describe a constraint rather than a column. */
const NOT_A_COLUMN =
  /^(PRIMARY\s+KEY|UNIQUE(\s+KEY|\s+INDEX)?|KEY|INDEX|CONSTRAINT|FOREIGN\s+KEY|FULLTEXT|SPATIAL|CHECK)\b/i;

/**
 * Pull the type out of a column definition, keeping balanced parens so `DECIMAL(10,2)` and
 * `ENUM('Open','Closed')` survive intact rather than being cut at the first comma.
 */
function readType(rest: string): string {
  let i = 0;
  while (i < rest.length && /\s/.test(rest[i]!)) i += 1;
  const startOfType = i;

  while (i < rest.length) {
    const ch = rest[i]!;
    if (ch === '(') {
      const group = readBalanced(rest, i);
      if (!group) break;
      i = group.end;
      continue;
    }
    if (/\s/.test(ch)) break;
    i += 1;
  }
  return rest.slice(startOfType, i).trim();
}

export interface ParsedDump {
  schema: SchemaMap;
  /** Every table found, in file order — useful for reporting tables we did not expect. */
  tables: string[];
  /** Row counts are unknowable from a --no-data dump; present so callers can be explicit. */
  hasData: false;
}

export function parseMysqlDump(sql: string): ParsedDump {
  const schema: SchemaMap = new Map();
  const tables: string[] = [];

  // Match CREATE TABLE, tolerating IF NOT EXISTS, optional db qualifier and quoting style.
  const create =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"]?)([A-Za-z0-9_$]+)\1\s*(?:\.\s*([`"]?)([A-Za-z0-9_$]+)\3\s*)?\(/gi;

  let m: RegExpExecArray | null;
  while ((m = create.exec(sql)) !== null) {
    // With a db qualifier (`db`.`table`) the table is the second identifier.
    const table = m[4] ?? m[2]!;
    const open = create.lastIndex - 1;
    const body = readBalanced(sql, open);
    if (!body) continue; // truncated dump — skip rather than emit a half-read table

    const columns = new Map<string, { type: string; nullable: boolean }>();
    for (const def of splitColumns(body.text)) {
      if (NOT_A_COLUMN.test(def)) continue;

      const named = /^[`"]?([A-Za-z0-9_$]+)[`"]?\s+([\s\S]+)$/.exec(def);
      if (!named) continue;
      const name = named[1]!;
      const rest = named[2]!;

      columns.set(name, {
        type: readType(rest),
        // MySQL columns are nullable unless declared NOT NULL. A trailing "NULL" is the default.
        nullable: !/\bNOT\s+NULL\b/i.test(rest),
      });
    }

    schema.set(table, columns);
    tables.push(table);
    create.lastIndex = body.end;
  }

  return { schema, tables, hasData: false };
}
