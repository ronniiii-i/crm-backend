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

const envSchema = z
  .object({
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

    SYSTEM_DATABASE_URL: z.string().min(1, 'SYSTEM_DATABASE_URL is required'),

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
      }),

    JWT_EXPIRES_IN: z.string().default('1h'),

    /** Product name used in email senders, subjects, and templates. */
    APP_NAME: z.string().min(1).default('Clasp Workspace'),

    /** Fallback workspace name when a caller does not supply one. */
    DEFAULT_TENANT_NAME: z.string().min(1).default('Default Workspace'),

    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().int().positive().default(6379),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_TLS: z
      .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
      .default('false'),
    REDIS_DB: z.coerce.number().int().min(0).default(0),
    REDIS_KEY_PREFIX: z.string().min(1).default('claspworkspace'),
    REDIS_CONNECT_TIMEOUT: z.coerce.number().int().positive().default(3000),
    /**
     * Optional Redis connection string used for cross-instance notification
     * fan-out. When absent the in-process bus is used.
     */
    REDIS_URL: z.string().url().optional(),
    /**
     * When Redis is unreachable, serve a bounded in-process cache instead of
     * disabling caching entirely. Entries are capped at 60s so a permission
     * change is observed quickly even without cross-instance invalidation.
     */
    REDIS_FALLBACK_MEMORY: z.enum(['true', 'false']).default('true'),

    FRONTEND_URL: z.string().default('http://localhost:3000'),

    /** Default support address shown in email footers and used as reply-to. */
    SUPPORT_EMAIL: z.string().email().default('support@claspworkspace.com'),

    RECAPTCHA_SECRET: z.string().optional(),

    // -------------------------------------------------------------------------
    // Phase 4 platform configuration
    // -------------------------------------------------------------------------

    /** Number of trusted reverse-proxy hops; "false" disables trust proxy. */
    TRUST_PROXY: z.string().default('1'),

    RATE_LIMIT_ENFORCE: z.enum(['true', 'false']).default('true'),
    RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().positive().default(15),
    RATE_LIMIT_API_PER_MIN: z.coerce.number().int().positive().default(600),
    RATE_LIMIT_WRITE_PER_MIN: z.coerce.number().int().positive().default(120),
    RATE_LIMIT_EXPORT_PER_HOUR: z.coerce.number().int().positive().default(10),

    AUTH_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),

    /**
     * Email platform. defaults are resolved at runtime: enabled in production,
     * disabled in test, and a logging transport in development without a key.
     */
    EMAIL_ENABLED: z.enum(['true', 'false']).optional(),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z
      .string()
      .refine(
        (value) =>
          /^(?:[^<>]+<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/.test(
            value.trim(),
          ),
        'EMAIL_FROM must be an address or "Name <address>"',
      )
      .or(z.literal(''))
      .optional(),
    EMAIL_REPLY_TO: z.string().email().or(z.literal('')).optional(),
    EMAIL_OVERRIDE_TO: z.string().email().or(z.literal('')).optional(),
    APP_URL: z.string().url().or(z.literal('')).optional(),
    /** How tenant links are built: `path` (default) or `subdomain`. */
    ROOT_DOMAIN_MODE: z.enum(['path', 'subdomain']).default('path'),

    STORAGE_DRIVER: z.enum(['local', 'r2']).default('local'),
    STORAGE_MAX_AVATAR_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(5_242_880),
    STORAGE_MAX_ATTACHMENT_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(26_214_400),
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_BUCKET: z.string().optional(),
    R2_PUBLIC_BASE_URL: z.string().optional(),
    R2_ENDPOINT: z.string().optional(),

    SSE_ENABLED: z.enum(['true', 'false']).default('true'),

    /**
     * When false, only a Tenant Admin may submit a leave request whose start
     * date is in the past. When true, every requester may backdate.
     */
    LEAVE_ALLOW_BACKDATED: z.enum(['true', 'false']).default('false'),

    SOFT_DELETE_ENFORCE: z.enum(['true', 'false']).default('true'),
    SOFT_DELETE_RETENTION_DAYS: z.coerce.number().int().positive().default(90),

    EXPORT_MAX_ROWS: z.coerce.number().int().positive().default(100_000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    // Production must fail fast rather than starting with a half-configured
    // email platform. The kill switch (EMAIL_ENABLED=false) does not remove the
    // key from the environment, so these stay required.
    const required: Array<[string, string | undefined]> = [
      ['RESEND_API_KEY', env.RESEND_API_KEY],
      ['EMAIL_FROM', env.EMAIL_FROM],
      ['APP_URL', env.APP_URL],
    ];

    for (const [name, value] of required) {
      if (!value || value.trim().length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: `${name} is required in production`,
        });
      }
    }
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

  if (result.data.JWT_SECRET === result.data.SYSTEM_JWT_SECRET) {
    throw new Error(
      'JWT_SECRET and SYSTEM_JWT_SECRET must differ. Please use different secrets.',
    );
  }

  return result.data;
}
