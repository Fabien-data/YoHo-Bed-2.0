import { loadConfig } from './config';
import { connectLegacy } from './mysql';
import { discover, formatReport } from './discover';

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

async function main(): Promise<number> {
  const command = process.argv[2] as Command | undefined;
  if (!command || !COMMANDS.includes(command)) {
    console.error(`usage: etl <${COMMANDS.join('|')}>`);
    return 2;
  }

  if (command === 'discover') {
    const url = process.env.LEGACY_MYSQL_URL;
    if (!url) {
      console.error(
        'LEGACY_MYSQL_URL is required, e.g.\n' +
          '  LEGACY_MYSQL_URL=mysql://readonly:pw@host:3306/armyoftheload pnpm --filter @yohobed/etl discover\n' +
          'Read-only credentials are sufficient — discovery never writes.',
      );
      return 2;
    }
    const db = await connectLegacy(url);
    try {
      const report = await discover(db, new Date().toISOString());
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
