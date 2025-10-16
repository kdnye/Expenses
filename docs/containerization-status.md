# Containerization Status

As of the October 15, 2025 refactor the Docker assets in this repository are intentionally empty placeholders.
The team consolidated all container orchestration into the internal infrastructure repository so that
application code and runtime images can evolve on separate release cadences. The following commits cleared the
previous contents:

- `810cd5b4`: removed the development `compose.yaml` definitions for the Postgres and API services.
- `554f744f`: removed the production-oriented `docker-compose.yml` stack.
- `0dcb09f8`: removed the multi-stage `Dockerfile` used for Cloud Run and other image-based deploys.

If you need the original Compose or Dockerfile configurations, reference the history at those commits or use the
infrastructure repository images documented in `docs/OPERATIONS_GUIDE.md`. Day-to-day development now relies on the
local Node toolchain (`npm install`, `npm run dev`, `npm test`, etc.) instead of Docker. Deployments are handled by
pre-built images published from the infrastructure repository; this application repository no longer builds them
independently.
