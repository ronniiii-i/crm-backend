const fs = require('fs');
const file = 'src/config/env.validation.ts';
let c = fs.readFileSync(file, 'utf8');
c = c.replace(
  "DIRECT_URL: z.string().min(1).optional(),\n\n  JWT_SECRET:",
  "DIRECT_URL: z.string().min(1).optional(),\n\n  SYSTEM_DATABASE_URL: z.string().min(1).optional(),\n\n  JWT_SECRET:",
);
c = c.replace(
  "  JWT_EXPIRES_IN: z.string().default('1h'),",
  "  SYSTEM_JWT_SECRET: z\n    .string()\n    .min(16, 'SYSTEM_JWT_SECRET must be at least 16 characters')\n    .refine((value) => !PLACEHOLDER_SECRETS.includes(value.toLowerCase()), {\n      message:\n        'SYSTEM_JWT_SECRET still uses a placeholder value — generate a unique secret',\n    })\n    .optional(),\n\n  JWT_EXPIRES_IN: z.string().default('1h'),",
);
fs.writeFileSync(file, c);
console.log('done');
