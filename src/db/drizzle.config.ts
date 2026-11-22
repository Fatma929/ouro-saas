import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

const rawConnectionUrl = process.env.DATABASE_URL?.trim();
const connectionUrl =
  rawConnectionUrl &&
  (rawConnectionUrl.startsWith('postgres://') || rawConnectionUrl.startsWith('postgresql://'))
    ? rawConnectionUrl
    : undefined;
const rawSsl = (process.env.DB_SSL || process.env.PGSSLMODE || 'disable').trim().toLowerCase();
const sslOption =
  rawSsl === 'true' || rawSsl === 'require' || rawSsl === 'verify-full'
    ? ('require' as const)
    : rawSsl === 'no-verify'
    ? { rejectUnauthorized: false }
    : false;

function buildDbCredentials() {
  if (connectionUrl) {
    return {
      url: connectionUrl,
      ssl: sslOption,
    };
  }

  const sqlHost = process.env.SQL_HOST || process.env.PGHOST;
  const sqlDbName = process.env.SQL_DB_NAME || process.env.PGDATABASE;
  const user = process.env.SQL_ADMIN_USER || process.env.SQL_USER || process.env.PGUSER;
  const password = process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD || process.env.PGPASSWORD;
  const hasStubs = /^\d+$/.test((process.env.DATABASE_URL || '').trim());
  const rawPort = hasStubs ? undefined : process.env.SQL_PORT || process.env.PGPORT;
  const port = Number(rawPort || 5432);

  if (!sqlHost) {
    throw new Error('DATABASE_URL or SQL_HOST must be set in environment variables.');
  }
  if (!sqlDbName) {
    throw new Error('DATABASE_URL or SQL_DB_NAME must be set in environment variables.');
  }
  if (!user) {
    throw new Error('DATABASE_URL or SQL_ADMIN_USER/SQL_USER must be set in environment variables.');
  }
  if (!password) {
    throw new Error('DATABASE_URL or SQL_ADMIN_PASSWORD/SQL_PASSWORD must be set in environment variables.');
  }

  return {
    host: sqlHost,
    port,
    user,
    password,
    database: sqlDbName,
    ssl: sslOption,
  };
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials: buildDbCredentials(),
  verbose: true,
});

