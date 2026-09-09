# Validation record

Validation performed September 9, 2026 with synthetic data.

- Node v24.18.0; PostgreSQL server 18.4; PostgreSQL restore clients 18.6.
- Combined integration/configuration/regression run: 22 tests passed, 0 failed, 0 skipped. This comprises 20 substantive scenarios and two parent tests. Real PostgreSQL and real local SMTP capture were used. One logged P0001 is an intentionally injected failure whose rollback is asserted.
- Actual mobile Chrome journey: PASS at 390x844, five screens without horizontal overflow, player signup to fulfilled glass through a separate staff session. Mandatory handoff confirmation and broken-video fallback passed. No unexpected browser errors. Evidence: screenshots/browser-results.json.
- Actual backup/restore: PASS, all 13 public tables matched row counts and full-row fingerprints against a consistent snapshot. Evidence: BACKUP_VERIFICATION.json. An application smoke check on the restored database confirmed completion, fulfillment, audit, health and entry.
- Docker image build: PASS, production npm ci --omit=dev and non-root image configuration. Further container runtime and clean clone checks recorded below when complete.

Production provider delivery, Render deployment, a permanent hostname, real R2 assets, event load/coverage, and hosted backup policy still require external setup and validation. No production QR or fake public deployment URL is supplied.
