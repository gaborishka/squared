import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg';
import { POSTGRES_SCHEMA } from './schema.js';
import { OUTPUT_DIMENSIONALITY } from '../services/embeddings.js';

let pool: Pool | null = null;
let initialized = false;

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error('DATABASE_URL is required. Squared now uses PostgreSQL as its primary runtime database.');
  }
  return value;
}

function resolveSsl(): PoolConfig['ssl'] {
  const mode = process.env.PGSSLMODE?.trim().toLowerCase();
  if (!mode || mode === 'disable') return undefined;
  if (mode === 'require' || mode === 'prefer') return { rejectUnauthorized: false };
  if (mode === 'verify-ca' || mode === 'verify-full') return { rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

export function getPool(): Pool {
  if (pool) return pool;

  pool = new Pool({
    connectionString: requireDatabaseUrl(),
    ssl: resolveSsl(),
  });

  pool.on('error', (error) => {
    console.error('PostgreSQL pool error:', error);
  });

  return pool;
}

export async function initializeDatabase(): Promise<Pool> {
  if (initialized) return getPool();

  const db = getPool();
  await db.query('SELECT 1');
  await db.query(POSTGRES_SCHEMA);
  initialized = true;
  return db;
}

export async function withTransaction<T>(runner: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await runner(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function queryRows<T extends QueryResultRow>(
  sql: string,
  values: unknown[] = [],
  client?: Pick<PoolClient, 'query'>,
): Promise<T[]> {
  const executor = client ?? getPool();
  const result = await executor.query<T>(sql, values);
  return result.rows;
}

export async function queryRow<T extends QueryResultRow>(
  sql: string,
  values: unknown[] = [],
  client?: Pick<PoolClient, 'query'>,
): Promise<T | null> {
  const rows = await queryRows<T>(sql, values, client);
  return rows[0] ?? null;
}

export function toVectorLiteral(values: number[]): string {
  const normalized = values.length === 0 ? new Array(OUTPUT_DIMENSIONALITY).fill(0) : values;
  return `[${normalized.map((value) => Number(value).toFixed(12).replace(/\.?0+$/, '')).join(',')}]`;
}

export async function closeDatabase(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
  initialized = false;
}
