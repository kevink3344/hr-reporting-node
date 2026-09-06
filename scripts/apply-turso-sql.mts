import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getLibsqlClient } from '../src/db-turso.js';
import { isTursoConfigured } from '../src/config.js';

// Usage: npx tsx scripts/apply-turso-sql.mts <sql-file>
const fileArg = process.argv[2];
if (!fileArg) {
  console.error('Usage: npx tsx scripts/apply-turso-sql.mts <sql-file>');
  process.exit(1);
}
if (!isTursoConfigured()) {
  console.error('Turso not configured. Set TURSO_DATABASE_URL/TURSO_API_KEY in .env');
  process.exit(1);
}

const filePath = resolve(process.cwd(), fileArg);
const sql = readFileSync(filePath, 'utf8');
const client = getLibsqlClient();

console.log(`Applying ${fileArg} (${sql.length} chars)...`);
// Strip the comment-only lines to keep the log readable, but pass everything.
await client.executeMultiple(sql);
console.log('Done. Applied successfully.');
