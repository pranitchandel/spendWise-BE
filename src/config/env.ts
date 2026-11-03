import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1),
  DNS_SERVERS: z.string().default(''),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900_000),
  RATE_LIMIT_MAX: z.coerce.number().default(200),
  LOG_LEVEL: z.string().default('info'),
  TZ: z.string().default('Asia/Kolkata'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables', parsed.error.flatten().fieldErrors);
  if (process.env.NODE_ENV !== 'test') {
    process.exit(1);
  }
}

export const env = parsed.success
  ? parsed.data
  : ({
      NODE_ENV: 'test' as const,
      PORT: 4000,
      MONGODB_URI: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/spendwise-test',
      DNS_SERVERS: '',
      JWT_ACCESS_SECRET: 'test-access-secret-min-32-characters!!',
      JWT_REFRESH_SECRET: 'test-refresh-secret-min-32-characters!',
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      CORS_ORIGIN: 'http://localhost:5173',
      COOKIE_SECURE: false,
      RATE_LIMIT_WINDOW_MS: 900_000,
      RATE_LIMIT_MAX: 1000,
      LOG_LEVEL: 'silent',
      TZ: 'Asia/Kolkata',
    });
