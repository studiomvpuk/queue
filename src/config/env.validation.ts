import { randomBytes } from 'crypto';
import { z } from 'zod';

/**
 * Auto-generate a 48-char random secret at boot. Used as a FALLBACK
 * when JWT_ACCESS_SECRET or JWT_REFRESH_SECRET are not set in the env.
 * Sessions won't survive app restarts with an ephemeral key, which is
 * fine for first-deploy testing. Real production should always set these.
 */
function autoSecret(name: string): string {
  const key = randomBytes(36).toString('base64');
  // eslint-disable-next-line no-console
  console.warn(`⚠️  ${name} not set — generated ephemeral secret. Sessions won't survive restarts.`);
  return key;
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  API_PREFIX: z.string().default('api/v1'),
  CORS_ORIGINS: z.string().default('*'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(1).default(autoSecret('JWT_ACCESS_SECRET')),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_SECRET: z.string().min(1).default(autoSecret('JWT_REFRESH_SECRET')),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(2_592_000),

  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),

  TERMII_API_KEY: z.string().optional().default(''),
  TERMII_SENDER_ID: z.string().optional().default('QueueEase'),
  TWILIO_ACCOUNT_SID: z.string().optional().default(''),
  TWILIO_AUTH_TOKEN: z.string().optional().default(''),
  TWILIO_FROM: z.string().optional().default(''),
  SMS_DAILY_CAP: z.coerce.number().int().positive().default(5),

  RESEND_API_KEY: z.string().optional().default(''),
  RESEND_FROM_EMAIL: z.string().optional().default('QueueEase <noreply@queueease.com>'),

  EXPO_ACCESS_TOKEN: z.string().optional().default(''),

  PAYSTACK_SECRET_KEY: z.string().optional().default(''),
  PAYSTACK_WEBHOOK_SECRET: z.string().optional().default(''),

  SENTRY_DSN: z.string().optional().default(''),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),

  // Phase 3
  DAILY_API_KEY: z.string().optional().default(''),
  USSD_ENABLED: z.enum(['true', 'false']).transform(v => v === 'true').default('false'),
});

export type Env = z.infer<typeof schema>;

export function envValidation(raw: Record<string, unknown>): Env {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`\n✗ Environment validation failed:\n${issues}\n`);
  }
  return parsed.data;
}
