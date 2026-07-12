import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const here = dirname(fileURLToPath(import.meta.url));
const url =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/yohobed';

const client = postgres(url, { max: 1 });
const db = drizzle(client);

try {
  console.log('→ Running Drizzle migrations…');
  await migrate(db, { migrationsFolder: join(here, '..', 'drizzle') });

  console.log('→ Applying RLS policies + app role…');
  const rls = readFileSync(join(here, 'rls.sql'), 'utf8');
  await client.unsafe(rls);

  console.log('✓ Database migrated and secured.');
} finally {
  await client.end();
}
