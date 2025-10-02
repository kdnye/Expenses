# Expenses API Server

This package contains an Express-based API for ingesting finalized expense reports and serving the single-page application compiled into the repository's `/public` directory.

## Prerequisites

- Node.js 18+
- npm 9+
- PostgreSQL 14+ (or a compatible managed instance)

## Environment variables

Create a `.env` file alongside `package.json` with the following keys:

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | No | Port used by the HTTP server (defaults to `3000`). |
| `DATABASE_URL` | Yes | PostgreSQL connection string used by Prisma. Example: `postgresql://postgres:postgres@localhost:5432/expenses?schema=public`. |
| `API_KEY` | Yes | Shared secret token that clients must provide in the `x-api-key` header when creating reports. |
| `ADMIN_JWT_SECRET` | Yes | Secret string used to sign administrator session cookies. Use a long, random value. |

## Available scripts

```bash
# Install dependencies
npm install

# Run the API in watch mode
npm run dev

# Compile TypeScript output
npm run build

# Start the compiled server
npm start

# Generate Prisma client
npm run prisma:generate

# Apply local development migrations (creates new migration files when schema changes)
npm run prisma:migrate

# Apply migrations in production environments
npm run prisma:deploy
```

## Admin authentication

The server exposes administrator endpoints under `/api/admin/*` and an SPA at `/admin` for finance users. Authentication uses
HTTP-only JWT cookies signed with `ADMIN_JWT_SECRET`. Only users with the `CFO` or `SUPER` roles can access the export APIs.

- `POST /api/admin/login` &ndash; accepts `{ "username": "...", "password": "..." }`, validates the credentials, and creates an
  eight-hour session cookie.
- `POST /api/admin/logout` &ndash; clears the active session.
- `GET /api/admin/session` &ndash; returns the authenticated user's profile, enforcing the CFO/super role requirement.
- `GET /api/admin/reports` &ndash; streams a ZIP archive containing `reports.csv` and `expenses.csv` for the requested date range.

### Provisioning administrator accounts

Administrator credentials are stored in the `admin_users` table. Usernames are persisted in lowercase so that sign-ins are
case-insensitive. To create an account, hash the password with `bcryptjs` and insert the record using Prisma or SQL. The
following script illustrates the Prisma approach:

```bash
cd server
node --env-file=.env <<'NODE'
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const username = 'cfo';
const password = 'SuperSecret!1';
const passwordHash = await bcrypt.hash(password, 12);

await prisma.adminUser.upsert({
  where: { username },
  update: { passwordHash, role: 'CFO' },
  create: { username, passwordHash, role: 'CFO' }
});

console.log('Provisioned admin user');
await prisma.$disconnect();
NODE
```

Alternatively, run the same logic in a seed script or migration. Ensure that passwords are rotated periodically and stored
securely.

## Database migrations

The Prisma schema (`prisma/schema.prisma`) defines two tables, `reports` and `expenses`, keyed by `report_id`. The generated migration creates composite indexes on `(employee_email, finalized_at)` and `(finalized_year, finalized_month, finalized_week)` to support efficient filtering by employee or reporting period.

To create and apply the initial migration locally:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/expenses?schema=public" npm run prisma:migrate -- --name init
```

Ensure the database exists before running the migration. The same `DATABASE_URL` must be present when starting the API so that report submissions are persisted.

## Serving the SPA

The Express app serves static assets from `<repo-root>/public`. Copy or symlink the built frontend into that directory (for example, `npm run build` from the frontend project) so that `public/index.html` exists. Requests that do not match `/api/*` will fall back to returning that file, enabling client-side routing.
