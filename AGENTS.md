# AGENTS Instructions (kdnye/expenses)

These are lightweight, practical rules for contributing and maintaining this repo. They mirror patterns used in sibling repos and add a few finance/PII-specific guardrails.

## 1) Code Style

* Prefer **Python 3.11+**, **react**, **js**, **rust**.
* Format with **black** (line length 88). Organize imports with **isort**. Lint with **ruff** (or flake8). Type check with **mypy** on new/changed modules.
* 4-space indentation. Docstrings use Google-style or reST—be consistent.
* Keep modules small and single-purpose (parser, loader, model, service, api).

```bash
# local setup
pip install -r requirements.txt -r requirements-dev.txt
pre-commit install
```

## 2) Tests

* Use **pytest**. Add/adjust tests with each change.
* Aim for coverage on branch logic around money math, dates, and currency.
* Include at least one failure-path test for data loaders and external APIs.

```bash
pytest -q
pytest -q tests/integration  # slower tests
```

## 3) Data & PII Safety

* Never commit real customer/vendor data. Use fixtures or generated samples.
* Redact identifiers (names, emails, phone, invoice #s) in logs and errors.
* Environment variables only for secrets/keys. Do **not** hard-code.
* If adding exports/reports, default to excluding PII; require an explicit flag to include it.

## 4) Configuration

* Local config via `.env` (not committed). Provide `.env.example` with sane defaults.
* All new settings must be documented in **README** and loaded centrally (e.g., `config.py`).

## 5) Database & Migrations (if applicable)

* Use Alembic (or repo-specific tool) for schema changes.
* Each migration: clear purpose, reversible `downgrade`, and a test that touches the new column/index.

## 6) Structure & Naming (suggested)

```
expenses/
  api/            # REST/CLIs, request/response models
  domain/         # core entities, money/date utilities
  io/             # adapters: CSV, XLSX, TMS/ERP connectors
  services/       # business workflows: import, reconcile, classify
  storage/        # DB models, repositories
  tasks/          # scheduled jobs, backfills
  tests/
```

* File names are lowercase_with_underscores; classes are PascalCase; functions are snake_case.

## 7) Logging & Errors

* Standard logging via `logging` with module-level logger.
* No secrets in logs. For values like tokens, log last 4 characters only.
* Raise domain-specific exceptions for predictable error handling.

## 8) Performance & Data Volume

* Prefer streaming parsers for large CSV/XLSX.
* Avoid loading entire workbooks into memory. Chunk where possible.
* Index columns used in joins or WHERE clauses.

## 9) Docstrings & Comments

* Brief, beginner-friendly docstrings on public functions/classes.
* Document inputs/outputs, units (e.g., cents vs dollars), and external deps.
* Inline comments for tricky finance edge cases (rounding, accrual periods, fiscal calendars).

## 10) Git Hygiene & Branching

* Branch from `main` using `feature/<short-kebab-summary>`.
* Small, focused commits. Avoid drive-by refactors unrelated to the change.
* Keep PRs < ~400 LOC when possible. Split otherwise.

### Commit messages (conventional-ish)

* `feat:` new capability, `fix:` bug, `docs:`, `chore:`, `refactor:`, `test:`.
* Body explains **why** and any migration/backfill steps.

## 11) Pull Requests

* Include: purpose, screenshots (if UI), risk/rollback, and test notes.
* Checklist before requesting review:

  * [ ] `black` / `ruff` clean
  * [ ] `mypy` (new/edited files) passes
  * [ ] `pytest` green
  * [ ] README/ADR updated if behavior/config changed
  * [ ] Migration + seed/backfill steps documented (if DB)

## 12) ADRs (Architecture Decisions)

* For non-trivial changes (new data source, classification model, storage engine), add an ADR under `docs/adrs/` summarizing context, options, decision, and consequences.

## 13) CI (if/when enabled)

* Pipeline stages: lint → type-check → unit tests → integration tests (tagged) → build artifact.
* Fail on missing migrations or unformatted code.

## 14) Release & Versioning

* Tag releases `vMAJOR.MINOR.PATCH`.
* Changelog entries grouped by `Added/Changed/Fixed/Removed`.

## 15) Local Dev Shortcuts

```bash
# format & lint
black .
ruff check . --fix
mypy expenses  # or specific package(s)

# run selected tests
pytest -q -k "reconcile or importer"
```

---

### Notes for AI/code-gen agents

* Agents must obey this file. Prefer safe transformations and keep changes minimal.
* Always run formatters/linters and add/update tests.
* When touching data flows, add a short `SECURITY.md` note if PII exposure risk changed.

> When in doubt: optimize for clarity, tests, and data safety over cleverness.
