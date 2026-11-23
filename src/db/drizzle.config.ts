import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

const PREVIEW_APP_URL_PATTERN = /^https:\/\/ais-(dev|pre)-[a-z0-9-]+\.[a-z0-9.-]*run\.app(?:\/|$)/i;
const PREVIEW_K_SERVICE_PATTERN = /^ais-(dev|pre)-[a-z0-9-]+$/i;

function isPreviewRuntimeEnv(env: NodeJS.ProcessEnv): boolean {
  if ((env.NODE_ENV || '').trim().toLowerCase() === 'production') return false;
  if (env.OURO_PREVIEW_RUNTIME?.trim().toLowerCase() === 'true') return true;
  if (PREVIEW_K_SERVICE_PATTERN.test((env.K_SERVICE || '').trim())) return true;
  if (PREVIEW_APP_URL_PATTERN.test((env.APP_URL || '').trim())) return true;
  return false;
}

const previewMode = isPreviewRuntimeEnv(process.env);
const rawConnectionUrl = process.env.DATABASE_URL?.trim();
const isPreviewNumericStub = previewMode && Boolean(rawConnectionUrl && /^\d+$/.test(rawConnectionUrl));

if (rawConnectionUrl && !isPreviewNumericStub && !rawConnectionUrl.startsWith('postgres://') && !rawConnectionUrl.startsWith('postgresql://')) {
  throw new Error('DATABASE_URL must start with postgres:// or postgresql://.');
}

const connectionUrl = !isPreviewNumericStub && rawConnectionUrl ? rawConnectionUrl : undefined;
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
  const rawPort = isPreviewNumericStub ? undefined : (process.env.SQL_PORT || process.env.PGPORT)?.trim();
  const port = rawPort ? Number(rawPort) : 5432;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid SQL_PORT/PGPORT "${rawPort}". Expected an integer between 1 and 65535.`);
  }
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
