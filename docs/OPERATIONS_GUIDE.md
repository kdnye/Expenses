# Freight Services Expense Reporting Operations Guide

This guide captures the institutional knowledge required to maintain, operate, and extend the Freight Services expense reporting platform. It is written for engineers, analysts, and finance partners who may be onboarding without prior exposure to the repository.

## 1. Product overview

The application streamlines the preparation and submission of employee expense reports while enforcing company policy. It is delivered as a static web client backed by an Express API that persists finalized reports, stores receipts, and offers administrative exports for finance users.

Key capabilities include:

- Drafting expense reports with inline validation (meal limits, mileage caps, receipt requirements).
- Persisting draft state locally in the browser and reviving previous reports.
- Uploading and tracking receipts per expense line.
- Finalizing reports via the API for downstream accounting workflows.
- Exporting summarized CSVs and receipt download links for finance administrators.
- Offline-ready experience through a service worker and manifest assets.

## 2. Repository layout

```
├── index.html / admin.html     # Web entry points compiled into public/
├── src/                        # Browser application source (ES modules)
├── public/                     # Static bundle served by the API
├── styles.css                  # Shared styling for the SPA
├── server/                     # Express API (TypeScript) with Prisma ORM
├── tests/                      # Vitest suites covering the client logic
├── k8s/                        # Kubernetes manifests for production rollout
├── Dockerfile                  # NGINX image for static hosting
└── docs/                       # Operational and policy documentation
```

The frontend is authored in vanilla JavaScript to keep runtime dependencies minimal. It persists state in `localStorage`, synchronizes DOM fields to a canonical data structure, and serializes submissions for the server (`src/reportPayload.js`). The backend API (in `server/`) validates payloads, secures administrator sessions, and integrates with external object storage for receipts.

## 3. Environment setup

### 3.1 Local frontend workflow

1. Install Node.js 18+ and npm 9+.
2. Serve the repository root with a static file server (for example `python -m http.server 8000`).
3. Open `http://localhost:8000` in a browser. The service worker will cache core assets after the first load.

The frontend does not require a build step; ES modules are loaded directly from `src/`. For production, copy the compiled assets (from any bundler or the existing files) into `public/` so that the server can serve them.

### 3.2 Local API workflow

1. `cd server`
2. `npm install`
3. Create a PostgreSQL 14+ database and ensure the `DATABASE_URL` is available in `.env`.
4. Run `npm run prisma:migrate` to apply the schema.
5. Start the API with `npm run dev`. The server will listen on `PORT` (default `3000`).

The API automatically serves the static frontend from `<repo-root>/public`. Adjust CORS or static asset paths in `server/src/main.ts` if you host the frontend separately.

### 3.3 Testing

Unit tests (Vitest) cover the data model, report payload generator, and policy calculations. Run them from the repository root:

```bash
npm test
```

### 3.4 Deployment

- **Containerized static hosting**: Build and run the NGINX image defined in `Dockerfile` to serve the compiled frontend on platforms like Cloud Run.
- **Full stack deployment**: Use the GitHub Actions workflow (`.github/workflows/google.yml`) to build, push, and deploy the API container to Google Kubernetes Engine using the manifests in `k8s/`.

Ensure Workload Identity Federation is configured so GitHub Actions can impersonate the Google Cloud service account without static keys (see `README.md` for step-by-step instructions).

## 4. Frontend architecture

- **State management**: `src/storage.js` persists a normalized report state keyed by `STORAGE_KEY`. Fresh sessions derive from `constants.DEFAULT_STATE`.
- **Expense metadata**: `src/constants.js` defines supported expense types, account codes, and policy hints (meal, travel, mileage). UI controls hydrate from this source of truth to remain consistent with finance expectations.
- **Policy enforcement**: `src/main.js` calculates totals, enforces receipt attachments, checks meal caps, and tracks mileage reimbursements at the IRS rate (`IRS_RATE`). Policy copy is displayed to users via `policy` descriptors attached to each expense type.
- **Report payload assembly**: `src/reportPayload.js` transforms the interactive state into the immutable structure expected by the API, including totals and computed reimbursement amounts. Totals can be imported directly into accounting systems.
- **Utilities**: `src/utils.js` contains formatting helpers (currency, UUID generation, numeric parsing) to keep the UI code focused on behavior.

### Key UI flows

1. **Add expense line** → `createExpenseRow` in `src/main.js` generates DOM nodes, binds input listeners, and keeps the DOM synchronized with the canonical state map.
2. **Receipt upload** → Files are staged locally, validated against type/size limits, and then streamed to `/api/receipts`. The API responds with metadata that is saved alongside the expense.
3. **Finalization** → Submissions call `/api/reports` with the payload built by `buildReportPayload`. Successful responses purge local state and record the submission in `state.history`.

## 5. Backend architecture

- **Framework**: Express with TypeScript (`server/src/app.ts` and `server/src/main.ts`).
- **Database**: Prisma ORM manages a PostgreSQL schema with `reports`, `expenses`, `receipts`, and `admin_users` tables. Composite indexes enable fast filtering by employee and reporting period.
- **Authentication**: Administrator SPA (`/admin`) uses JWT cookies signed via `ADMIN_JWT_SECRET`. Only users with `CFO` or `SUPER` roles can access export endpoints.
- **Receipt storage**: Configurable provider (`memory`, `s3`, or `gcs`). Metadata persistence ensures receipts remain linked to expenses after submission.
- **Exports**: `/api/admin/reports` streams CSV files bundled in a ZIP archive, including signed URLs for receipt downloads when object storage is configured.

Routine maintenance tasks:

- Rotate `API_KEY` and administrator credentials regularly.
- Monitor receipt storage quotas and lifecycle policies.
- Keep Prisma migrations in sync with schema changes and run `npm run prisma:deploy` before deploying new releases.
- Rebuild the static frontend and copy assets into `public/` whenever UI changes are made.

## 6. Expense reimbursement policy (official copy)

The following policy governs all employee reimbursement requests. It must remain in sync with finance-issued guidance.

### Expense Reimbursement

The Company will reimburse employees for reasonable and necessary expenses incurred in the course of Company business. Reasonable expenses incurred by employees in the performance of their duties generally include transportation, travel expenses, business meals and entertainment. The following guidelines should be followed:

#### Reimbursable Expenses

##### Travel Expenses

- **Domestic Airfare** – All flights should be booked at the lowest coach fare available. First-class tickets are not reimbursable; furthermore, any upgrades to first class are at your expense.
- **International Airfare** – Business class is permitted only for international travel of at least eight (8) hours of continuous published air travel (not including time spent on layovers). For international travel under eight hours; coach class airfare should be booked.
- **Unused, Non-Refundable and/or Lost Tickets** – If possible, refund unused tickets as soon as possible. If the ticket is non-refundable, the amount will be applied to future corporate trips. If necessary, Freight Services will refund charges due to changes in flights and schedules. Please contact your Manager with regard to flight adjustments. Lost airline tickets will not be reimbursed. Upon alerting Freight Services, a replacement ticket will be issued for a fee. If the Company is unable to issue a new ticket, you are responsible for filling out and submitting a lost ticket application.
- **Miscellaneous** – Reasonable phone charges will be reimbursed while you are away from home. You should use calling cards or cellular phones instead of hotel room calls. While traveling internationally, use calling cards. Reasonable hotel gym charges will be reimbursed. Charges should not exceed $15 per day.

##### Meals

Only actual expenditures will be reimbursed; therefore, receipts are needed for every meal, regardless of its cost. In the case that a receipt is not available, maximum reimbursement for meals is as follows:

- Breakfast – $10
- Lunch – $15
- Dinner – $25

You should use the amounts listed above as guidelines for meals while traveling. Freight Services understands that while in major metropolitan areas (i.e., New York City and Chicago) the cost may be higher.

##### Entertainment

Business-related entertainment expenses are allowed. Business-related entertainment expenses are costs that are incurred as a direct result of Company business and include activities such as potential client meals and/or entertainment where business discussions occurred. Expenses for the sole purpose of your entertainment will not be reimbursed.

##### Car Rental

- **Car Size** – Generally, compact-size cars should be rented, unless a medical reason requires that you rent a larger vehicle. If two or more employees are traveling together, a mid-size car may be rented.
- **Insurance** – In the United States and Canada, employees must purchase the loss damage waiver, personal effects protection and personal accident insurance coverage that is offered by the rental company. If you have questions about the appropriate amount of coverage, please contact the Company before purchasing the insurance. Freight Services is also insured through American Express (coverage limited to cars with a current value of $50,000 or less). International travel should be arranged prior to departure. Please contact your Manager for further instructions.

##### Other Transportation

- **Mileage Reimbursement** – You will be reimbursed at the current IRS rate for mileage over the “base” mileage while conducting company business. Base mileage is the round trip mileage between work and home. Normal commuting time and miles are not eligible for reimbursement.
- **Parking, Taxi, Tolls & Ground Transportation** – Parking, bridge, tunnel, and road tolls will be reimbursed when traveling for business purposes. You should submit receipts for all such expenses with your reimbursement request. When traveling for thirty-six (36) hours or more, you should park in the airport’s long-term parking lot or offsite lots. Reasonable use of shuttles, taxis, etc. will be reimbursed. Please contact your Manager before booking limos and town cars, if there are no other options.

##### Miscellaneous Travel

- **Laundry** – Laundry, dry cleaning, and pressing will be reimbursed only if the business trip exceeds seven (7) full days.
- **Gratuities** – Reasonable gratuities for services such as meals, hotel shuttles, etc. will be reimbursed.

##### Cancellations

It is your responsibility to notify any applicable party of any cancellation (e.g., hotel, car rental, airfare) prior to the time of cancellation to avoid “no-show” charges. Freight Services will not reimburse “no-show” charges, unless they were unavoidable.

#### Non-Reimbursable Expenses

The following is a non-inclusive list of expenses that are not eligible for reimbursement:

- Air phone charges, except for emergency use. The employee must submit a written explanation of the reason for use.
- Annual fees and any interest or late fees on credit cards.
- Personal sundries such as reading materials, medication, batteries, toiletries, etc.
- Personal grooming services such as haircuts and manicures.
- Personal entertainment such as movies, videos, airline headphones, and other expenses which cannot be defined as a business entertainment.
- Club dues for airline club rooms (i.e., Red Carpet Club).
- Travel accident insurance, unless covered under a car rental insurance policy.
- Fines for traffic or parking violations.
- Theft of personal property, including articles stolen from either personal or rental cars, unless covered under a car rental insurance policy.

All business expenses must be approved in writing by the Vice President of Operations. Employees with reimbursable expenses must submit approved expense reports, along with dated receipts, to the Vice President of Operations at the end of the month in which the expenses were incurred. Only the Vice President of Operations can authorize exceptions to this policy. Expense forms may be obtained from your Manager.

We strive to distribute reimbursement checks in a timely manner after submission of an approved expense report. Expense policies are set in accordance with applicable law, and, accordingly, expense reimbursements are not considered compensation in any way.

## 7. Accounting reference tables

These tables map expense categories to their corresponding general ledger accounts and should remain synchronized with `src/constants.js` and server-side validation.

### 7.1 Expense types

| Expense type | Account |
| --- | --- |
| Maintenance & Repairs | 51020 |
| Parking & Storage - COGS | 51070 |
| Vehicle Supplies | 51090 |
| State Permits/Fees/ Tolls | 52030 |
| Meals & Entertainment - COGS | 52070 |
| Travel - COGS | 52080 |
| FSI Global Overhead | 56000 |
| Telephone - GA | 62000 |
| Utilities | 62070 |
| IT/Computer | 62080 |
| Office Supplies | 62090 |
| Printing & Postage | 62100 |
| Meals & Entertainment - GA | 64180 |
| Travel - GA | 64190 |
| FSI Global  G&A | 66500 |

### 7.2 Chart of accounts summary

| Description | Accnt. # |
| --- | --- |
| Cost of Goods Sold | 50000 |
| OPS Wages | 50500 |
| OPS Wages - Terminal | 50510 |
| OPS Wages - Driver | 50520 |
| OPS Wages - Bonus | 50540 |
| OPS Wages - Training | 50550 |
| OPS Wages - Overtime | 50560 |
| OPS Wages - PTO | 50570 |
| OPS Wages - Holiday | 50580 |
| Workers Compensation | 50590 |
| Workers Comp - Safety Incentive | 50595 |
| Purchase Transportation - Agent | 50600 |
| Purchase Transport - Carrier | 50610 |
| PurchaseTransport - Small Pack | 50620 |
| Vehicle Expense | 51000 |
| Vehicle - Fuel | 51010 |
| Vehicle - Maint/Repairs | 51020 |
| Vehicle - Leased | 51030 |
| Vehicle - License/Registration | 51040 |
| Vehicle - Insurance | 51050 |
| Vehicle - Tracking | 51060 |
| Vehicle - Parking/Storage | 51070 |
| Vehicle - Equipment | 51080 |
| Vehicle - Supplies | 51090 |
| Tax - IFTA | 52010 |
| Tax - Road Use | 52020 |
| State Permits/Fees | 52030 |
| Equipment Rental | 52040 |
| Uniforms | 52050 |
| Terminal Supplies | 52060 |
| Meals/Entertainment | 52070 |
| Travel Expense | 52080 |
| G&A Expense | 60000 |
| GA Wages | 60100 |
| GA Wages - Admin | 60110 |
| GA  Wages - Bonus | 60115 |
| GA Wages - Overtime | 60120 |
| GA Wages - PTO | 60130 |
| GA Wages - Holiday | 60140 |
| Worker's Compensation | 60150 |
|  | 61000 |
| Insurance - Business | 61010 |
| Insurance - Cargo | 61020 |
| Insurance - Auto | 61030 |
| Insurance - Worker's Comp | 61040 |
| Fringe | 61500 |
| Fringe - Health Insurance (ER) | 61505 |
| Fringe - Health Insurance (EE) | 61510 |
|  | 61515 |
| Fringe - Payroll Taxes | 61520 |
| Fringe - 401K | 61530 |
| Employment Screening | 61540 |
| Employee Training | 61550 |
| Telephone | 62000 |
| Rent - Office | 62010 |
| Rent - Offsite | 62020 |
| Payroll Service Fees | 62025 |
| Professional Fees - Legal | 62030 |
| Professional Fees - Accounting | 62040 |
| Professional Fees - Contractor | 62050 |
| Facility Maintenance/Repairs | 62060 |
| Utilities | 62070 |
| IT/Computer | 62080 |
| Office Supplies | 62090 |
| Printing/Postage | 62100 |
| Property Taxes | 62110 |
| Licenses/Permits | 62120 |
| BD Wages | 64100 |
| BD Wages - Business Development | 64110 |
| BD Wages - Bonus | 64115 |
| BD Wages - Overtime | 64120 |
| BD Wages - PTO | 64130 |
| BD Wages - Holiday | 64140 |
| Recruiting | 64150 |
| Advertising/Promotion | 64160 |
| Dues/Subscriptions | 64170 |
| Charitable Contributions | 64175 |
| Meals/Entertainment | 64180 |
| Travel | 64190 |
| Automobile | 64200 |
| Interest/Bank Fees | 65000 |
| Penalties | 65050 |
| Credit Card Fees | 65100 |
| Reconciliation Differences | 66900 |
| Depreciation | 67000 |
| Federal Corporate Income Tax | 68010 |
| Arizona Coporate Income Tax | 68020 |
| Other State Tax | 68025 |
| Franchise Tax | 68030 |
| Expenses not categorized elsewhere | 69800 |

## 8. Operational checklists

### New developer onboarding

- Clone the repository and skim this guide plus `README.md`.
- Run `npm install` in both the root (for tests) and `server/` (for the API).
- Provision a `.env` for the API and migrate the database.
- Launch the frontend locally and submit a test report against a local API instance.
- Review Vitest coverage and add tests for any new policy or account changes.

### Release checklist

- Confirm policy text and account tables match finance source documents.
- Run `npm test` at the root and `npm run test` (if applicable) inside `server/`.
- Build or copy the latest frontend assets into `public/`.
- Run `npm run build` inside `server/` if deploying the compiled TypeScript output.
- Execute the GitHub Actions deployment pipeline or manually push the Docker image.
- After deployment, validate `/api/health` (if implemented) and the admin export flow.

Keeping this document updated alongside code changes ensures that future maintainers can operate the platform confidently.
