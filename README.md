# FSI Expense Submission Portal

A full-stack web application for capturing, approving, and exporting Freight Services employee expenses with built-in policy safeguards.

## Features
- Employees enter expenses in the browser and submit them directly to the database through the bundled backend service.
- Submissions are automatically flagged for manager and finance review with a two-stage approval workflow.
- Inline policy reminders for travel, meals, and mileage reimbursements with automatic mileage calculations at the IRS rate.
- Managers review incoming reports, record decisions, and unblock finance approvals through the shared admin console.
- Finance analysts can download detailed ZIP exports **or** NetSuite-ready journal summaries for a chosen date window.
- Offline-ready experience once the site has been loaded at least once while online.
- Attach receipts (images or PDFs) to individual expenses and track upload status before submitting.

## Comprehensive documentation

For a full operational handbook—including architecture notes, onboarding checklists, and the official Freight Services expense reimbursement policy—see [`docs/OPERATIONS_GUIDE.md`](docs/OPERATIONS_GUIDE.md).

## Getting started

### Frontend test prerequisites

Whether you are working locally or inside the provided Codespaces devcontainer, install the Node dependencies before running any frontend-focused checks:

```bash
npm install
```

The devcontainer intentionally skips automatic installation, so run this command manually prior to executing tasks such as `npm test` or `npm run lint`.

### Environment configuration

Configuration values for both the frontend build and the backend API are loaded centrally by `server/src/config.ts`. Copy `.env.example` to `.env` and adjust the values for your environment before starting any servers:

```bash
cp .env.example .env
```

Key variables include:

| Variable | Purpose |
| --- | --- |
| `ADMIN_JWT_SECRET` | Required secret used to sign administrator session cookies. |
| `RECEIPT_MAX_BYTES` / `RECEIPT_MAX_FILES` | Upper bounds enforced by the receipt upload endpoint. |
| `RECEIPT_STORAGE_PROVIDER` | Storage backend (`memory`, `s3`, `gcs`, or `gdrive`). |
| `S3_*` / `GCS_*` / `GDRIVE_*` | Provider-specific settings for receipt storage integrations. |

The defaults in `.env.example` keep uploads in memory. Switch to S3, Google Cloud Storage, or Google Drive by updating `RECEIPT_STORAGE_PROVIDER` and filling in the corresponding section of the file. Invalid or missing combinations are detected at startup so misconfiguration is caught early.

### Run the full stack with Docker Compose

1. Create a `.env` file in the repository root that at minimum defines the administrator session secret:
   ```bash
   ADMIN_JWT_SECRET="replace-with-a-long-random-string"
   ```
   You can also override the default Postgres credentials exposed by `docker-compose.yml` by setting `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` in the same file. The Compose configuration injects everything into the API container and derives `DATABASE_URL` automatically.
2. Build and start the stack:
#### Development / Codespaces (`compose.yaml`)

1. (Optional) Create a `.env` file in the repository root to override the defaults. Without one the stack boots with `API_KEY=local-dev-api-key`, `ADMIN_JWT_SECRET=dev-admin-secret`, and a PostgreSQL database named `expenses`.
2. Start the stack:
   ```bash
   docker compose up
   ```
   The development compose file mounts the repository into the container, installs dependencies on first boot, generates the Prisma client, waits for Postgres, applies migrations, and then launches `npm run dev` with file watching enabled. Restart the service to pick up dependency changes.
3. Visit [http://localhost:3000](http://localhost:3000) to access the combined API and single-page application. The Postgres container publishes port `5432` so tools like `psql` can connect for inspection or local debugging.

To create new Prisma migrations during development, run:

```bash
docker compose run --rm api npx prisma migrate dev --name <migration-name>
```

The command uses the mounted workspace, so any generated migration files appear directly in `server/prisma/migrations/`.

#### Production-style image (`docker-compose.yml`)

The repository also includes a production-focused compose file that builds the multi-stage API image. Follow the same `.env` guidance above and then start the services with:

```bash
docker compose -f docker-compose.yml up --build
```

This variant runs the compiled server (`node dist/index.js`) inside the container instead of the watch mode used for local development.

### Local PostgreSQL installation

If you prefer to run PostgreSQL directly on your workstation instead of the
bundled Docker container, follow the step-by-step guide in
[`docs/POSTGRESQL_SETUP.md`](docs/POSTGRESQL_SETUP.md). The walkthrough covers
installing PostgreSQL on macOS, Linux, and Windows, provisioning the expected
database/role with `scripts/bootstrap-postgres.sh`, and wiring the API to the
local instance.

### Frontend-only preview

1. Launch the Vite development server:
   ```bash
   npm run dev
   ```
2. Open the printed local URL in your browser and start adding expenses.
3. When you are ready to inspect the production build, run `npm run build` followed by `npm run preview` to serve the optimized assets.

Local storage persistence is optional; if the browser disables access, the app still functions without saving state between sessions.

## Configuring the API endpoint

By default the web client sends receipt uploads and report submissions to the same origin it was served from (for example `/api/reports`) so they persist directly to the shared database.
When the API is hosted on a different domain or behind a reverse proxy prefix, provide the target base URL through one of the following options:

- Add a meta tag to `index.html` (and `admin.html` for the finance console):
  ```html
  <meta name="fsi-expenses-api-base" content="https://expenses-api.example.com" />
  ```
- Define a global configuration object before loading the main bundle (or `src/admin.js` for the finance console):
  ```html
  <script>
    window.__FSI_EXPENSES_CONFIG__ = { apiBaseUrl: 'https://expenses-api.example.com' };
  </script>
  ```

Relative values such as `/internal/expenses-api` are also supported. If no configuration is supplied the app continues to use same-origin requests.

## Container image

The application can be packaged as a lightweight NGINX container by using the included `Dockerfile`. The container listens on the `PORT` environment variable (default `8080`), making it compatible with platforms like Google Cloud Run.

Build and run locally:

```bash
docker build -t expenses-web:local .
docker run --rm -p 8080:8080 expenses-web:local
```

The site will be served at http://localhost:8080.

## Cloud Run static hosting

### Manual deployment

Use the following sequence to build, push, and deploy the static frontend to Google Cloud Run. Replace the sample identifiers with values from your project:

```bash
export PROJECT_ID="my-expenses-project"
export REGION="us-east4"
export GAR_LOCATION="us-east4"
export REPOSITORY="expenses"
export SERVICE="expenses"
export IMAGE_NAME="expenses-frontend"
export IMAGE_TAG="$(git rev-parse --short HEAD)"
export IMAGE_URI="${GAR_LOCATION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_NAME}:${IMAGE_TAG}"

docker build -t "$IMAGE_URI" .
docker push "$IMAGE_URI"

gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "$IMAGE_URI" \
  --allow-unauthenticated \
  --platform managed
```

If you manage Cloud Run through a declarative YAML file, update the `spec.template.spec.containers[0].image` field with `IMAGE_URI` before calling `gcloud run services replace`.

### GitHub Actions workflow

The repository includes a workflow (`.github/workflows/cloud-run-frontend.yml`) that mirrors the manual steps above. On each push to `main`, the workflow:

1. Authenticates to Google Cloud via Workload Identity Federation.
2. Builds the frontend container with the commit SHA as the tag and pushes it to Artifact Registry.
3. Deploys the image to the configured Cloud Run service and promotes the revision to 100% traffic.

Configure the project-specific values described in the [GitHub configuration](#github-configuration) section to enable the pipeline.

## Kubernetes database configuration

The `k8s/` manifests now include a `StatefulSet` (`postgres-statefulset.yaml`) that provisions an in-cluster PostgreSQL 15 instance with persistent storage plus the secrets required by both the database and API deployments. Apply the manifests with Kustomize:

```bash
kubectl apply -k k8s/
```

Before deploying to a shared environment, replace the placeholder values in `k8s/api-secret.yaml` and `k8s/postgres-secret.yaml` or create the secrets through your preferred secret manager:

```bash
kubectl create secret generic expenses-api-secrets \
  --from-literal=DATABASE_URL="postgresql://<user>:<password>@<host>:5432/expenses?schema=public" \
  --from-literal=ADMIN_JWT_SECRET="<jwt-secret>"
```

Point `DATABASE_URL` at the internal service (`expenses-postgres`) for the bundled StatefulSet or swap the hostname for a managed database endpoint when you move to production. The API deployment reads all sensitive configuration from the `expenses-api-secrets` Secret so you can rotate credentials without modifying the manifest.

If you are using a managed PostgreSQL offering, omit `postgres-secret.yaml` and `postgres-statefulset.yaml` from your Kustomize overlay and configure `DATABASE_URL` to reference the managed instance directly.

Similarly, you can create the database credential secret at deployment time instead of editing the checked-in file:

```bash
kubectl create secret generic expenses-postgres-credentials \
  --from-literal=POSTGRES_DB="expenses" \
  --from-literal=POSTGRES_USER="<db-user>" \
  --from-literal=POSTGRES_PASSWORD="<db-password>"
```

The Kubernetes deployment mirrors the Compose behavior by running `npx prisma migrate deploy` before starting the Node.js server, ensuring each rollout applies pending migrations automatically. For zero-downtime upgrades with large migrations, consider running the deploy step manually before scaling up new pods.

## Offline support

The application registers a service worker that precaches the core HTML, CSS, JavaScript, and manifest assets. Load the site once while online so the service worker can install; subsequent visits (or reloads) will continue to work even without a network connection, using the cached assets for requests.

## Google Cloud deployment pipelines

This repository provides two GitHub Actions workflows:

- `.github/workflows/google.yml` builds the full-stack container and deploys it to Google Kubernetes Engine (GKE) using the manifests in `k8s/`.
- `.github/workflows/cloud-run-frontend.yml` builds the static frontend container and deploys it to Cloud Run.

### One-time Google Cloud setup

1. **Enable required APIs** in your Google Cloud project:
   - Artifact Registry (`artifactregistry.googleapis.com`)
   - Google Kubernetes Engine (`container.googleapis.com`)
   - Cloud Run Admin API (`run.googleapis.com`)
   - IAM Credentials API (`iamcredentials.googleapis.com`)
2. **Create infrastructure** (replace names with your preferred values):
   - Create an Artifact Registry *Docker* repository, e.g. `expenses` in region `us-central1`.
   - Create or reuse a GKE cluster (zonal or regional) capable of running public web workloads.
3. **Create a dedicated service account** (for example `github-actions@<PROJECT_ID>.iam.gserviceaccount.com`) and grant it the following roles:
   - `roles/artifactregistry.writer`
   - `roles/container.developer`
   - `roles/run.admin`
4. **Configure Workload Identity Federation** so GitHub can impersonate the service account without long-lived keys:
   - Create a Workload Identity Pool and Provider following the [google-github-actions/auth documentation](https://github.com/google-github-actions/auth#setting-up-workload-identity-federation).
   - Authorize the provider to impersonate the service account you created in step 3.
5. **Capture the identifiers** you will need for the workflows:
   - Google Cloud project ID (e.g. `my-expenses-project`)
   - Artifact Registry location (e.g. `us-central1`)
   - Artifact Registry repository name (e.g. `expenses`)
   - GKE cluster name (e.g. `expenses-cluster`)
   - GKE cluster location (zone or region, e.g. `us-central1-c`)
   - Kubernetes deployment name (matches the metadata name in `k8s/deployment.yaml`, default `expenses-web`)
   - Cloud Run service name (e.g. `expenses`)
   - Cloud Run region (e.g. `us-east4`)
   - Workload Identity Provider resource path (e.g. `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/<POOL>/providers/<PROVIDER>`)
   - Service account email (created in step 3)

### GitHub configuration

Add the following **repository variables** (Settings → Secrets and variables → Actions → Variables) so the workflow picks up your project-specific values without editing the workflow file:

| Variable name | Used by | Example value |
| ------------- | -------- | ------------- |
| `GCP_PROJECT_ID` | Both | `my-expenses-project` |
| `GAR_LOCATION` | Both | `us-central1` |
| `GAR_REPOSITORY` | Both | `expenses` |
| `WORKLOAD_IDENTITY_PROVIDER` | Both | `projects/123456789/locations/global/workloadIdentityPools/github/providers/expenses` |
| `WIF_SERVICE_ACCOUNT` | Both | `github-actions@my-expenses-project.iam.gserviceaccount.com` |
| `GKE_CLUSTER` | GKE only | `expenses-cluster` |
| `GKE_LOCATION` | GKE only | `us-central1-c` |
| `GKE_DEPLOYMENT_NAME` | GKE only | `expenses-web` |
| `CLOUD_RUN_SERVICE` | Cloud Run only | `expenses` |
| `CLOUD_RUN_REGION` | Cloud Run only | `us-east4` |

> **Note:** GitHub repository *variables* are appropriate here because the values are not secrets. Use repository *secrets* instead if you prefer to keep the identifiers private.

Once the variables are in place, pushes to the `main` branch will trigger the workflows to build and publish updated containers. The GKE workflow rolls out the API + frontend bundle, while the Cloud Run workflow updates the static frontend-only service.

You can inspect or customize the Kubernetes manifests under `k8s/` to tune replica counts, resource requests/limits, or service type.
