import { z } from 'zod';

/**
 * Runtime environment validation.
 *
 * The application refuses to boot when a required variable is missing or
 * looks unsafe (e.g. the well-known `supersecret` JWT fallback that used to
 * silently sign tokens with a publicly known key).
 */

const PLACEHOLDER_SECRETS = [
  'supersecret',
  'change-me-in-production',
  'changeme',
  'secret',
  'jwt-secret',
];

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  PORT: z.coerce.number().int().positive().default(3030),

  // Runtime connection: MUST be the non-owner `crm_app` role so that
  // Postgres Row Level Security is enforced.
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Migration / seeding connection (owner role). Only needed by the Prisma
  // CLI, but validated when present so a typo is caught early.
  DIRECT_URL: z.string().min(1).optional(),

  SYSTEM_DATABASE_URL: z.string().min(1).optional(),

  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET must be at least 16 characters')
    .refine((value) => !PLACEHOLDER_SECRETS.includes(value.toLowerCase()), {
      message:
        'JWT_SECRET still uses a placeholder value — generate a unique secret',
    }),

  SYSTEM_JWT_SECRET: z
    .string()
    .min(16, 'SYSTEM_JWT_SECRET must be at least 16 characters')
    .refine((value) => !PLACEHOLDER_SECRETS.includes(value.toLowerCase()), {
      message:
        'SYSTEM_JWT_SECRET still uses a placeholder value — generate a unique secret',
    })
    .optional(),

  JWT_EXPIRES_IN: z.string().default('1h'),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_TLS: z
    .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
    .default('false'),
  REDIS_DB: z.coerce.number().int().min(0).default(0),
  REDIS_KEY_PREFIX: z.string().min(1).default('claspcrm'),
  REDIS_CONNECT_TIMEOUT: z.coerce.number().int().positive().default(3000),
  /**
   * When Redis is unreachable, serve a bounded in-process cache instead of
   * disabling caching entirely. Entries are capped at 60s so a permission
   * change is observed quickly even without cross-instance invalidation.
   */
  REDIS_FALLBACK_MEMORY: z.enum(['true', 'false']).default('true'),

  FRONTEND_URL: z.string().default('http://localhost:3000'),

  MAIL_HOST: z.string().optional(),
  MAIL_PORT: z.coerce.number().int().positive().optional(),
  MAIL_USER: z.string().optional(),
  MAIL_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),

  RECAPTCHA_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates `process.env`.
 *
 * @throws {Error} when the environment is invalid. The message lists every
 * problem so a misconfigured deployment is fixed in one pass.
 */
export function validateEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => {
        const path = issue.path.join('.') || '(root)';
        return `  - ${path}: ${issue.message}`;
      })
      .join('\n');

    throw new Error(
      `Invalid environment configuration:\n${details}\n\n` +
        `Copy .env.example to .env and fill in the missing values.`,
    );
  }

  return result.data;
}
