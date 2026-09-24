import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
export default defineConfig({ dialect: 'postgresql', schema: './db/schema.js', out: './db/migrations', dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED || '' } });
