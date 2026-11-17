import 'dotenv/config';
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const integer = (key: string, fallback: number, max: number) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > max) throw new Error('Invalid configuration: ' + key);
    return value;
  };
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required; copy .env.example to .env');
  const url = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use PostgreSQL');
  const production=env.NODE_ENV==='production';
  if(production && !env.ALLOWED_ORIGINS)throw new Error('ALLOWED_ORIGINS is required in production');
  const origins=(env.ALLOWED_ORIGINS??'http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:3000').split(',').map(x=>x.trim());
  if(origins.some(x=>{try{const parsed=new URL(x);return parsed.origin!==x || !['http:','https:'].includes(parsed.protocol) || (production && parsed.protocol!=='https:');}catch{return true;}}))throw new Error('Invalid ALLOWED_ORIGINS');
  return {production,origins,host:env.HOST ?? '127.0.0.1', port:integer('PORT',3000,65535), databaseUrl:env.DATABASE_URL, dbConnectTimeoutMs:integer('DB_CONNECT_TIMEOUT_MS',2000,30000)};
}
