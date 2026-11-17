import pg from 'pg';
export function createPool(connectionString: string, timeout: number) {
  return new pg.Pool({connectionString, max:5, connectionTimeoutMillis:timeout, idleTimeoutMillis:10000, statement_timeout:3000, query_timeout:3500});
}
