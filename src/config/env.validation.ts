import { z } from 'zod';

/**
 * Strict env validation. Fail-fast at boot if any required var is missing
 * or malformed. Prevents silent misconfig at runtime.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  API_PREFIX: z.string().default('api/v1'),
  CORS_ORIGINS: z.string().default(''),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
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
