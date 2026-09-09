# Validation record

Validation performed September 9, 2026 with synthetic data.

- Node v24.18.0; PostgreSQL server 18.4; PostgreSQL restore clients 18.6.
- Combined integration/configuration/regression run: 22 tests passed, 0 failed, 0 skipped. This comprises 20 substantive scenarios and two parent tests. Real PostgreSQL and real local SMTP capture were used. One logged P0001 is an intentionally injected failure whose rollback is asserted.
- Actual mobile Chrome journey: PASS at 390x844, five screens without horizontal overflow, player signup to fulfilled glass through a separate staff session. Mandatory handoff confirmation and broken-video fallback passed. No unexpected browser errors. Evidence: screenshots/browser-results.json.
- Actual backup/restore: PASS, all 13 public tables matched row counts and full-row fingerprints against a consistent snapshot. Evidence: BACKUP_VERIFICATION.json. An application smoke check on the restored database confirmed completion, fulfillment, audit, health and entry.
- Docker image build: PASS, production npm ci --omit=dev and non-root image configuration. A fresh PostgreSQL 18.6 container migrated successfully; the app ran as UID 1000 on PORT 4317, and health/entry returned 200. Temporary test containers/network were removed. Evidence: DOCKER_VERIFICATION.json.

Production provider delivery, Render deployment, a permanent hostname, real R2 assets, event load/coverage, and hosted backup policy still require external setup and validation. No production QR or fake public deployment URL is supplied.

## Clean clone and restart

An independent local Git clone installed with npm ci --offline from the populated npm cache, without copying node_modules or local secrets. npm run migrate built a fresh database; the combined suite passed all 22 tests again. npm start served port 43187. A real pg_ctl restart of the workspace-local PostgreSQL cluster preserved the original browser cookie and the same player profile. Evidence: CLEAN_INSTALL_VERIFICATION.json. The offline flag proves repeatability from the downloaded lockfile packages; it is not a fresh registry connectivity test.

## Final status

No failed or skipped automated checks remain in the executed suites. Clean clone source was commit 7a1c6f4; subsequent changes are documentation and validation evidence only. Production deployment and sender/domain/media configuration remain external prerequisites.
