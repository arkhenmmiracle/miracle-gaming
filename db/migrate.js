import { database } from '../src/database.js';
import { drizzle as nodeDrizzle } from 'drizzle-orm/node-postgres';
import { migrate as nodeMigrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as localDrizzle } from 'drizzle-orm/pglite';
import { migrate as localMigrate } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
export async function migrateLocal(client) { await localMigrate(localDrizzle(client),{migrationsFolder:'./db/migrations'}); }
if(process.argv[1]?.endsWith('/migrate.js')) {
  if(process.env.LOCAL_DEMO==='true') {
    if(process.env.NODE_ENV==='production')throw new Error('Local demo disabled in production');
    const {PGlite}=await import('@electric-sql/pglite');const db=new PGlite('./.local-db');await migrateLocal(db);await db.close();
  } else {
    const url=process.env.DATABASE_URL_UNPOOLED;
    if(!url)throw new Error('DATABASE_URL_UNPOOLED diperlukan untuk migrasi Neon');
    const pool=new pg.Pool({connectionString:url});await nodeMigrate(nodeDrizzle(pool),{migrationsFolder:'./db/migrations'});await pool.end();
  }
  console.log('Migrasi selesai.');
}
