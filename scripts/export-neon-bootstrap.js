// Export the committed Drizzle migration and demo seed for a NEW, EMPTY database.
// Use npm run db:migrate for normal deployments and subsequent migrations.
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { seed } from '../db/seed.js';
const literal = value => typeof value === 'string' ? "'" + value.replaceAll("'", "''") + "'" : String(value);
const statements = ['BEGIN;', 'CREATE SCHEMA IF NOT EXISTS drizzle;', 'CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);'];
for (const migration of readMigrationFiles({ migrationsFolder: './db/migrations' })) {
  statements.push(...migration.sql);
  statements.push(`INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES ('${migration.hash}',${migration.folderMillis});`);
}
const recorder = { transaction: fn => fn(recorder), query: async (sql, values = []) => {
  if (sql.startsWith('SELECT')) return { rows: [] };
  statements.push(sql.replace(/\$(\d+)/g, (_, i) => literal(values[Number(i)-1])) + ';');
  return { rows: [] };
}};
await seed(recorder);
statements.push('COMMIT;');
console.log(statements.join('\n'));
