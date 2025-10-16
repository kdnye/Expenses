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

## Containerization status

Container orchestration now lives in the internal infrastructure repository. During the October 15, 2025 refactor we cleared
the local Docker assets (`compose.yaml`, `docker-compose.yml`, and `Dockerfile`) so this application repository focuses on the
TypeScript/Node codebase. The empty files remain only as placeholders for tooling that expects them. See
[`docs/containerization-status.md`](docs/containerization-status.md) for the timeline and migration guidance.

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

## Deployment overview

Container builds, runtime images, and deployment automation are now maintained in the infrastructure repository. Use the
playbooks linked from [`docs/containerization-status.md`](docs/containerization-status.md) to provision environments. The
application repository focuses on source code, database migrations, and Kubernetes manifests.

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
