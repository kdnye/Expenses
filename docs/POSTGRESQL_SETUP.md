# Local PostgreSQL setup

The Expenses stack requires a PostgreSQL 15+ instance for persistence. While the
repository already ships Docker and Kubernetes manifests with managed database
containers, these steps walk through installing PostgreSQL directly on your
workstation and wiring it to the application.

## 1. Install PostgreSQL

### macOS (Homebrew)

```bash
brew update
brew install postgresql@15
brew services start postgresql@15
```

The `brew services start` command keeps the database running in the background.
If you prefer manual control, replace it with `pg_ctl -D $(brew --prefix postgresql@15)/var/postgresql@15 start`.

### Ubuntu / Debian

```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl enable --now postgresql
```

The distribution packages install PostgreSQL under the `postgres` system user and
start the service automatically.

### Windows (Chocolatey)

```powershell
choco install postgresql15 --params '/Password:postgres'
```

After installation open **pgAdmin** or the "SQL Shell (psql)" shortcut and
connect as the `postgres` superuser. Remember to add the PostgreSQL `bin`
directory to your `PATH` so the CLI tools are available from PowerShell or CMD.

> **Security note:** Change the default `postgres` superuser password immediately
> after installation. The script below only requires temporary superuser access
> to create the application database and role.

## 2. Bootstrap the application database

Once PostgreSQL is running locally, provision the expected role and database by
running the helper script from the repository root:

```bash
export PGUSER=postgres
export PGPASSWORD='<superuser-password>'
export POSTGRES_PASSWORD='<app-role-password>'
./scripts/bootstrap-postgres.sh
```

You can override `POSTGRES_DB`, `POSTGRES_USER`, and other connection variables
before invoking the script. For example, to create a database called
`expenses_dev` owned by the role `expenses_app`:

```bash
export POSTGRES_DB=expenses_dev
export POSTGRES_USER=expenses_app
export POSTGRES_PASSWORD='<app-role-password>'
./scripts/bootstrap-postgres.sh
```

Add `--apply-migrations` to run the Prisma migrations immediately after the
role/database provisioning step (requires `npm install` to have been executed in
`server/`):

```bash
./scripts/bootstrap-postgres.sh --apply-migrations
```

When the option is omitted the script prints the exact `npx prisma migrate deploy`
command to run manually once dependencies are installed.

## 3. Point the application at the local database

Create or update the `.env` file in the repository root so the API process uses
the local database credentials:

```env
DATABASE_URL="postgresql://expenses:<app-role-password>@localhost:5432/expenses?schema=public"
ADMIN_JWT_SECRET="replace-with-a-long-random-string"
API_KEY="local-dev-api-key"
```

If you changed the database name, user, or schema in the bootstrap step, update
the connection string accordingly. Prisma expects the `schema` query parameter to
match the schema where migrations should run (default `public`).

## 4. Verify connectivity

With PostgreSQL running and the `.env` file in place, you can start the backend
API directly:

```bash
cd server
npm install
npm run build
npm run start
```

Alternatively launch the Docker Compose stack, which will now connect to your
locally installed PostgreSQL instance if `DATABASE_URL` points to `localhost`.

## Troubleshooting

- **`psql: error: connection to server failed`** – Verify that the PostgreSQL
  service is running and listening on the expected port (default `5432`). On
  macOS and Linux you can check `pg_ctl status` or `systemctl status postgresql`.
- **Authentication failures** – Confirm that the environment variables exported
  before running the bootstrap script match the superuser credentials you set
  during installation. On Windows you can store the password in a `pgpass.conf`
  file instead of exporting `PGPASSWORD`.
- **Special characters in passwords** – URL encode `@`, `:`, `/`, and other
  reserved characters before placing them inside `DATABASE_URL`.

Following these steps gives you a full PostgreSQL installation running alongside
the Expenses application without relying on containerized services.
