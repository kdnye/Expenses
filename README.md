# FSI Expense Report Builder

A lightweight web application for preparing Freight Services expense reports with built-in policy validation.

## Features
- Persist report header details and expense rows locally.
- Inline policy reminders for travel, meals, and mileage reimbursements.
- Automatic reimbursement calculations for capped categories and mileage at the IRS rate.
- Copy-ready text preview that mirrors the official expense form layout.
- Offline-ready experience once the site has been loaded at least once while online.
- Attach receipts (images or PDFs) to individual expenses and track upload status before submitting.

## Comprehensive documentation

For a full operational handbook—including architecture notes, onboarding checklists, and the official Freight Services expense reimbursement policy—see [`docs/OPERATIONS_GUIDE.md`](docs/OPERATIONS_GUIDE.md).

## Getting started
1. Serve the project with any static HTTP server (for example `python -m http.server 8000`).
2. Open the site in your browser and start adding expenses.
3. Copy the generated preview text into the company expense template when you are done.

Local storage persistence is optional; if the browser disables access, the app still functions without saving state between sessions.

## Configuring the API endpoint

By default the web client sends receipt uploads and report submissions to the same origin it was served from (for example `/api/reports`).
When the API is hosted on a different domain or behind a reverse proxy prefix, provide the target base URL through one of the following options:

- Add a meta tag to `index.html` (and `admin.html` for the finance console):
  ```html
  <meta name="fsi-expenses-api-base" content="https://expenses-api.example.com" />
  ```
- Define a global configuration object before loading `src/main.js` or `src/admin.js`:
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

## Offline support

The application registers a service worker that precaches the core HTML, CSS, JavaScript, and manifest assets. Load the site once while online so the service worker can install; subsequent visits (or reloads) will continue to work even without a network connection, using the cached assets for requests.

### Offline-only mode

When the deployment environment should never attempt to contact the API (for example, during training or on kiosks without internet access) enable offline-only mode. This hides the API key controls and changes the finalize action to save reports locally instead of sending them to the network. Receipt files selected while offline are stored in the browser using IndexedDB and rendered as downloadable links so they can be shared or uploaded later when connectivity is restored.

Choose one of the following configuration options before loading `src/main.js`:

- Add a meta tag to the HTML shell:
  ```html
  <meta name="fsi-expenses-offline-only" content="true" />
  ```
- Or set the global configuration flag:
  ```html
  <script>
    window.__FSI_EXPENSES_CONFIG__ = { offlineOnly: true };
  </script>
  ```

In offline-only mode, pressing **Finalize & save locally** serializes the report payload, stores it in the local history drawer (persisted in `localStorage`), and shows a confirmation message so finance teams can transfer the data manually later. Any receipts that were attached remain stored locally and continue to be listed alongside the report until the draft is cleared.

### Receipt storage limits and cleanup

Receipts are persisted in IndexedDB under the current draft ID so that uploads can resume after a page refresh or reconnection. If IndexedDB is unavailable (for example, in hardened browser profiles) the app falls back to the File System Access API's origin-private file system when supported, ensuring the files remain available offline. Each individual file is limited to 10&nbsp;MB, matching the validation enforced by the upload form. Stored blobs are removed automatically when:

- An expense is deleted from the draft
- Receipts are uploaded successfully to the server
- The draft is finalized (either online or offline) and a new draft is created
- The **Clear draft** action is invoked

If the browser denies IndexedDB access, receipt uploads will surface an error instructing the user to reattach the files after granting storage permission.

## Google Cloud deployment pipeline

This repository contains a GitHub Actions workflow (`.github/workflows/google.yml`) that builds the Docker image, pushes it to Google Artifact Registry, and deploys the container to Google Kubernetes Engine (GKE) using the manifests in the `k8s/` directory.

### One-time Google Cloud setup

1. **Enable required APIs** in your Google Cloud project:
   - Artifact Registry (`artifactregistry.googleapis.com`)
   - Google Kubernetes Engine (`container.googleapis.com`)
   - IAM Credentials API (`iamcredentials.googleapis.com`)
2. **Create infrastructure** (replace names with your preferred values):
   - Create an Artifact Registry *Docker* repository, e.g. `expenses` in region `us-central1`.
   - Create or reuse a GKE cluster (zonal or regional) capable of running public web workloads.
3. **Create a dedicated service account** (for example `github-actions@<PROJECT_ID>.iam.gserviceaccount.com`) and grant it the following roles:
   - `roles/artifactregistry.writer`
   - `roles/container.developer`
4. **Configure Workload Identity Federation** so GitHub can impersonate the service account without long-lived keys:
   - Create a Workload Identity Pool and Provider following the [google-github-actions/auth documentation](https://github.com/google-github-actions/auth#setting-up-workload-identity-federation).
   - Authorize the provider to impersonate the service account you created in step 3.
5. **Capture the identifiers** you will need for the workflow:
   - Google Cloud project ID (e.g. `my-expenses-project`)
   - Artifact Registry location (e.g. `us-central1`)
   - Artifact Registry repository name (e.g. `expenses`)
   - GKE cluster name (e.g. `expenses-cluster`)
   - GKE cluster location (zone or region, e.g. `us-central1-c`)
   - Kubernetes deployment name (matches the metadata name in `k8s/deployment.yaml`, default `expenses-web`)
   - Workload Identity Provider resource path (e.g. `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/<POOL>/providers/<PROVIDER>`)
   - Service account email (created in step 3)

### GitHub configuration

Add the following **repository variables** (Settings → Secrets and variables → Actions → Variables) so the workflow picks up your project-specific values without editing the workflow file:

| Variable name | Example value |
| ------------- | ------------- |
| `GCP_PROJECT_ID` | `my-expenses-project` |
| `GAR_LOCATION` | `us-central1` |
| `GAR_REPOSITORY` | `expenses` |
| `GKE_CLUSTER` | `expenses-cluster` |
| `GKE_LOCATION` | `us-central1-c` |
| `GKE_DEPLOYMENT_NAME` | `expenses-web` |
| `WORKLOAD_IDENTITY_PROVIDER` | `projects/123456789/locations/global/workloadIdentityPools/github/providers/expenses` |
| `WIF_SERVICE_ACCOUNT` | `github-actions@my-expenses-project.iam.gserviceaccount.com` |

> **Note:** GitHub repository *variables* are appropriate here because the values are not secrets. Use repository *secrets* instead if you prefer to keep the identifiers private.

Once the variables are in place, pushes to the `main` branch will trigger the workflow to build the image, push it to Artifact Registry, and deploy the new version to your cluster using the manifests in `k8s/`.

You can inspect or customize the Kubernetes manifests under `k8s/` to tune replica counts, resource requests/limits, or service type.
