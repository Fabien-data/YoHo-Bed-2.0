import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { loadConfig } from './config';
import { connectLegacy } from './mysql';
import { discover, buildReport, formatReport } from './discover';
import { parseMysqlDump } from './dump-schema';

/**
 * ETL entry point.
 *
 *   pnpm --filter @yohobed/etl discover   read-only: does the real schema match our assumptions?
 *   pnpm --filter @yohobed/etl migrate    move the data (not yet implemented — gated on discover)
 *   pnpm --filter @yohobed/etl parity     re-derive every booking's money and diff it
 *
 * `discover` is deliberately the only command that runs without a target database: it is the one
 * to run the moment legacy credentials exist, and it answers "what do we actually not know yet?"
 */

const COMMANDS = ['discover', 'migrate', 'parity'] as const;
type Command = (typeof COMMANDS)[number];

/** Read `--flag value` or `--flag=value` from argv. */
function argValue(flag: string): string | undefined {
  const args = process.argv.slice(3);
  const exact = args.indexOf(flag);
  if (exact !== -1 && args[exact + 1]) return args[exact + 1];
  const inline = args.find((a) => a.startsWith(`${flag}=`));
  return inline?.slice(flag.length + 1);
}

async function main(): Promise<number> {
  const command = process.argv[2] as Command | undefined;
  if (!command || !COMMANDS.includes(command)) {
    console.error(`usage: etl <${COMMANDS.join('|')}>`);
    return 2;
  }

  if (command === 'discover') {
    const now = new Date().toISOString();

    // A schema dump is just DDL text, so validating against one needs no server, no credentials
    // and no production access. This is the preferred route.
    const dumpPath = argValue('--dump') ?? process.env.LEGACY_SCHEMA_DUMP;
    if (dumpPath) {
      const sql = await readFile(dumpPath, 'utf8');
      const { schema, tables } = parseMysqlDump(sql);
      if (schema.size === 0) {
        console.error(
          `No CREATE TABLE statements found in ${dumpPath}. ` +
            'Was it produced with `mysqldump --no-data <db>`?',
        );
        return 2;
      }
      // A --no-data dump carries no row counts; omit them rather than report a misleading zero.
      const report = buildReport(schema, new Map(), basename(dumpPath), now);
      console.log(formatReport(report));
      console.log(`\n(${tables.length} table(s) in the dump; row counts unavailable from DDL.)`);
      return report.canProceed ? 0 : 1;
    }

    const url = process.env.LEGACY_MYSQL_URL;
    if (!url) {
      console.error(
        'Point discovery at either a schema dump (preferred) or a live database:\n\n' +
          '  pnpm --filter @yohobed/etl discover -- --dump path/to/schema.sql\n' +
          '      Produce it with: mysqldump --no-data -u USER -p armyoftheload > schema.sql\n' +
          '      No server, no credentials, safe to share — DDL only, no guest data.\n\n' +
          '  LEGACY_MYSQL_URL=mysql://readonly:pw@host:3306/armyoftheload \\\n' +
          '    pnpm --filter @yohobed/etl discover\n' +
          '      Read-only credentials are sufficient — discovery never writes.',
      );
      return 2;
    }
    const db = await connectLegacy(url);
    try {
      const report = await discover(db, now);
      console.log(formatReport(report));
      return report.canProceed ? 0 : 1;
    } finally {
      await db.close();
    }
  }

  // migrate/parity need both databases; fail fast with a useful message if either is absent.
  loadConfig();
  console.error(
    `"${command}" is not implemented yet — it is gated on a clean \`discover\` run against the ` +
      'real legacy database, because the schema on disk is a reconstruction and is known to be ' +
      'incomplete (see src/contract.ts).',
  );
  return 3;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
