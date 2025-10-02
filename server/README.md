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

## Database migrations

The Prisma schema (`prisma/schema.prisma`) defines two tables, `reports` and `expenses`, keyed by `report_id`. The generated migration creates composite indexes on `(employee_email, finalized_at)` and `(finalized_year, finalized_month, finalized_week)` to support efficient filtering by employee or reporting period.

To create and apply the initial migration locally:

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/expenses?schema=public" npm run prisma:migrate -- --name init
```

Ensure the database exists before running the migration. The same `DATABASE_URL` must be present when starting the API so that report submissions are persisted.

## Serving the SPA

The Express app serves static assets from `<repo-root>/public`. Copy or symlink the built frontend into that directory (for example, `npm run build` from the frontend project) so that `public/index.html` exists. Requests that do not match `/api/*` will fall back to returning that file, enabling client-side routing.
