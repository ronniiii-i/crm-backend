# Clasp Workspace backend

Private backend API for Clasp Workspace. The service is built with NestJS and
TypeScript and provides multi-tenant workspace management, authentication,
authorization, CRM/workspace records, and system administration.

## Project status

This is a private personal project and is not open source. All rights reserved.
Please don't redistribute or reuse the code without permission.

## What is in this repository

### Application capabilities

- Tenant/workspace provisioning, lifecycle, settings, invitations, and billing
  contact handling
- JWT authentication for workspace users and a separate system-admin
  authentication flow
- Email verification, password reset, refresh, logout, token blacklisting, and
  optional Google reCAPTCHA integration
- Role-based access control with modules, permissions, permission groups,
  overrides, data scopes, and route-level permission guards
- Tenant-aware CRM and workspace records, including contacts, deals, projects,
  tasks, departments, teams, attendance, expenses, inventory, invoices,
  payments, support tickets, notifications, documents, and form submissions
- Dashboard data and widgets
- Redis-backed caching with a bounded in-process fallback
- Request validation, CORS, throttling, cookies, and Swagger/OpenAPI
  documentation
- PostgreSQL row-level security (RLS) and tenant-scoped data access
- Seed data, demo workspace provisioning, phase-3 backfills, and SQL/RLS
  verification utilities

### Main API areas

The application has no global `/api` prefix. Representative route families
include:

| Area | Base routes |
| --- | --- |
| Authentication | `/auth`, `/system-admin/auth` |
| Public onboarding | `/public` |
| Users and profile | `/users`, `/profile` |
| Workspace data | `/workspace`, `/workspace/modules/:deptKey/:moduleKey/...` |
| Projects and dashboard | `/projects`, `/dashboard` |
| Access control | `/roles`, `/access-control`, `/auth/acl` |
| Tenant administration | `/tenant/settings`, `/departments`, `/invitations` |
| System administration | `/system-admin/tenants` |
| Billing | `/tenant/billing` |

The exact request and response contracts are available from the generated
Swagger UI while the application is running.

## Technology

- Node.js and npm
- NestJS 11
- TypeScript 5
- Prisma 6 with PostgreSQL
- Redis 4
- JWT/Passport
- Swagger/OpenAPI
- Jest, SuperTest, and TypeScript ESLint

## Prerequisites

- Node.js 18 or newer
- npm
- PostgreSQL with the required tenant RLS policies and roles
- Redis for shared caching (the application can use its bounded local fallback
  when configured)
- SMTP credentials if verification and password-reset email delivery is
  required

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and provide real, environment-specific
   values. Never commit `.env` or credentials.

3. Generate the Prisma client and apply the development migrations:

   ```bash
   npm run db:generate
   npx prisma migrate dev
   ```

4. Seed the configured database when needed:

   ```bash
   npm run db:seed
   ```

   Demo tenants can be enabled through the seed configuration and created with
   `npm run db:seed:demo`.

The application validates required environment variables before booting.
`DATABASE_URL` is the runtime connection and `DIRECT_URL` is intended for
migrations/seeding. `SYSTEM_DATABASE_URL` is required for isolated
system-admin database access. `JWT_SECRET` and `SYSTEM_JWT_SECRET` must be
long, unique, and different from each other.

## Configuration

The supported settings are documented in `.env.example`. The most important
values are:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Runtime PostgreSQL connection |
| `DIRECT_URL` | Prisma migration/seeding connection |
| `SYSTEM_DATABASE_URL` | Isolated system-admin connection |
| `JWT_SECRET` | Workspace-user token signing secret |
| `SYSTEM_JWT_SECRET` | System-admin token signing secret |
| `JWT_EXPIRES_IN` | Workspace token lifetime |
| `PORT` | HTTP port; defaults to `3030` |
| `FRONTEND_URL` | Primary allowed frontend origin |
| `REDIS_*` | Redis connection, TLS, timeout, and fallback settings |
| `MAIL_*` | SMTP connection and sender settings |
| `RECAPTCHA_SECRET` | Optional reCAPTCHA verification secret |

Do not copy production secrets into local development or commit them to the
repository.

## Running the service

```bash
# Development with watch mode
npm run start:dev

# Normal start
npm run start

# Build and run the compiled application
npm run build
npm run start:prod
```

By default the service listens on `http://localhost:3030`. The root endpoint
is `GET /`. Swagger UI is available at
`http://localhost:3030/api`; the OpenAPI JSON is available at
`http://localhost:3030/api-json`.

## Database and maintenance commands

```bash
npm run db:generate       # Generate the Prisma client
npm run db:migrate        # Create/apply development migrations
npm run db:seed           # Run the configured Prisma seed
npm run db:seed:demo      # Seed demo workspaces
npm run db:backfill:phase3
npm run test:rls          # Run the SQL row-level-security check
npm run db:reset          # Destructive: reset and reseed the database
```

Use `db:reset` only against a disposable development database.

## Testing and quality checks

```bash
npm test                  # Unit tests
npm run test:e2e          # End-to-end tests
npm run test:cov          # Tests with coverage
npm run test:rls          # PostgreSQL RLS verification
npm run build             # TypeScript/Nest production build
npm run lint              # ESLint (writes fixes)
npm run format            # Prettier
```

The `test/` directory includes coverage for environment validation, ACL and
RBAC behavior, tenant isolation, workspace APIs, performance, and SQL RLS
checks. Database-backed tests require the corresponding test environment and
database roles.

## Repository layout

```text
src/
  auth/             Authentication, JWT, ACL, and permission guards
  access-control/  Permission catalog and role permission management
  workspace/        Dynamic workspace modules, records, documents, submissions
  tenant/           Tenant context, lifecycle, settings, and isolation
  system-admin/    System-admin authentication and tenant operations
  dashboard/       Dashboard queries and widgets
  projects/        Project endpoints and services
  users/            User management
  roles/            Roles and assignable permissions
  departments/     Department management
  invitations/     Workspace invitations
  billing/         Tenant billing endpoints
  cache/            Redis and fallback caching
  prisma/           Prisma services and database access
  mail/             Email delivery
  config/           Environment parsing and validation
prisma/
  schema.prisma    PostgreSQL data model
  migrations/      Database migrations and RLS changes
  seed/            Default catalogs and workspace seed data
email-templates/   Handlebars email templates
test/              Unit, integration, e2e, performance, and SQL checks
```

## Internal development notes

- Keep tenant-scoped queries and cache keys tenant-aware.
- Use the runtime database role for application traffic; reserve the direct
  owner connection for Prisma migrations and seed operations.
- Preserve the separation between workspace-user tokens and system-admin
  tokens.
- Update migrations and relevant tests when changing the Prisma schema or RLS
  behavior.

## Contact

For questions or ideas, contact the project owner directly.

Copyright © 2026 Clasp Workspace. All rights reserved.
