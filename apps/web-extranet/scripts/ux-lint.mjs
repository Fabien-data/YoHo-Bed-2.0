#!/usr/bin/env node
/**
 * UX lint (docs/UX-STANDARD.md §11). Bans the patterns that make the product unsafe or silent:
 *
 * - `window.confirm`      → §5: use ConfirmDialog, which states the consequence.
 * - `'Validation failed'` → §5: say what is wrong and where.
 * - `.catch(() => {})`    → §5: a failure the person never hears about.
 *
 * Code written before the standard is listed in KNOWN_DEBT with how many times it offends. The
 * check is a ratchet: a NEW offence fails, and so does fixing one without lowering its count
 * here — so the list can only shrink, and it shrinks on the record.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIRS = ['app', 'components'];

const RULES = [
  { id: 'window-confirm', re: /window\.confirm\s*\(/g, why: 'use ConfirmDialog (§5)' },
  { id: 'validation-failed', re: /['"`]Validation failed['"`]/g, why: 'say what is wrong (§5)' },
  {
    id: 'silent-catch',
    re: /\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g,
    why: 'surface the failure (§5)',
  },
];

/** file (posix, relative to apps/web-extranet) → rule → count. Lower these as the debt is paid. */
const KNOWN_DEBT = {
  'app/app/roomview/page.tsx': { 'window-confirm': 3 },
  'app/app/deals/page.tsx': { 'silent-catch': 1 },
  'app/app/customers/page.tsx': { 'silent-catch': 2 },
  'app/app/layout.tsx': { 'silent-catch': 1 },
  'app/app/comms/page.tsx': { 'silent-catch': 1 },
  'app/app/inbox/page.tsx': { 'silent-catch': 1 },
  'app/app/page.tsx': { 'silent-catch': 1 },
  'app/app/reviews/page.tsx': { 'silent-catch': 1 },
  'components/notifications-bell.tsx': { 'silent-catch': 2 },
};

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(tsx?|jsx?)$/.test(name)) yield path;
  }
}

const found = {};
for (const dir of DIRS) {
  for (const path of files(join(ROOT, dir))) {
    const text = readFileSync(path, 'utf8');
    const file = relative(ROOT, path).split(sep).join('/');
    for (const rule of RULES) {
      const n = text.match(rule.re)?.length ?? 0;
      if (n) (found[file] ??= {})[rule.id] = n;
    }
  }
}

const problems = [];
const keys = new Set([...Object.keys(found), ...Object.keys(KNOWN_DEBT)]);
for (const file of [...keys].sort()) {
  for (const rule of RULES) {
    const now = found[file]?.[rule.id] ?? 0;
    const allowed = KNOWN_DEBT[file]?.[rule.id] ?? 0;
    if (now > allowed) {
      problems.push(`✗ ${file}: ${now}× ${rule.id} (allowed ${allowed}) — ${rule.why}`);
    } else if (now < allowed) {
      problems.push(
        `✗ ${file}: ${rule.id} is down to ${now} from ${allowed} — well done; lower KNOWN_DEBT in scripts/ux-lint.mjs`,
      );
    }
  }
}

if (problems.length) {
  console.error(`UX lint failed (docs/UX-STANDARD.md §11):\n${problems.join('\n')}`);
  process.exit(1);
}
const debt = Object.values(KNOWN_DEBT).reduce(
  (sum, rules) => sum + Object.values(rules).reduce((a, b) => a + b, 0),
  0,
);
console.log(`UX lint passed. Known debt remaining: ${debt}.`);
