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
  // Behind a reverse proxy the real client IP arrives in X-Forwarded-For; without this
  // every visitor shares the proxy address and rate limits collide.
  const trustProxy = env.TRUST_PROXY ? env.TRUST_PROXY.trim() === 'true' : production;
  // 邮箱验证码需要 SMTP。未配置时 smtp 为 null：站点正常运行，只关闭注册。
  const smtpHost = env.SMTP_HOST?.trim();
  const smtp = smtpHost ? {
    host: smtpHost,
    port: integer('SMTP_PORT', 465, 65535),
    secure: (env.SMTP_SECURE ?? 'true').trim() !== 'false',
    user: env.SMTP_USER?.trim() ?? '',
    pass: env.SMTP_PASS ?? '',
    from: env.MAIL_FROM?.trim() || env.SMTP_USER?.trim() || smtpHost,
  } : null;
  return {production,origins,trustProxy,smtp,host:env.HOST ?? '127.0.0.1', port:integer('PORT',3000,65535), databaseUrl:env.DATABASE_URL, dbConnectTimeoutMs:integer('DB_CONNECT_TIMEOUT_MS',2000,30000)};
}
