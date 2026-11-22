import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { getDatabaseProvider } from '../infra/database.ts';
import * as schema from './schema.ts';

export const createPool = (): Pool => {
  return getDatabaseProvider().getPool();
};

const pool = createPool();
export const db = drizzle(pool, { schema });
export const closeDatabasePool = () => getDatabaseProvider().close();

