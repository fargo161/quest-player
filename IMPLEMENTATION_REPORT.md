# Implementation report — Quest Player V0.1

## In plain language

The foundation is built. A player can enter a nickname, get a permanent Player ID, join As Above So Below, read/watch an introduction, and return to their profile. Email verification and recovery work through SMTP. Staff can find the right account, mark the quest complete, record selection for glass, and confirm physical handoff.

Completion and each reward stage are distinct. Mistakes can be corrected with reasons; history stays visible. A completed physical handoff stays on the record even when an exception is added. Repeated or simultaneous requests do not grant duplicate participation or duplicate digital fulfillment.

The database can hold future events under the same player identity. The code does not define the physical puzzles or final creative presentation. This is a functional foundation for that separate work.

This is not yet a live festival service: Render, a permanent hostname, actual email-provider credentials/sender verification, and real media content still need configuration. Local SMTP testing proves the code delivers mail to a server; it does not prove delivery into a public inbox. No production QR was generated against an invented hostname.

## Technical implementation

Stack: Node 24 LTS, Express 5, PostgreSQL 18, Nodemailer SMTP, server-rendered HTML/CSS, Docker packaging, Render Blueprint, public R2/CDN URLs. No microservices or frontend build framework.

### Records

| Table | Responsibility |
|---|---|
| players | UUID, unique QP reference, nickname, optional verified email |
| sessions | Hashed browser credentials, CSRF, optional expiring operator authority |
| email_tokens | Expiring single-use hashed verification/recovery secrets |
| events | Reusable event identity |
| quests | Event-owned quest, slug, intro text and external media URL |
| player_quests | Unique player/quest participation, ACTIVE or COMPLETED |
| rewards | Quest-associated reward definition |
| player_rewards | Unique entitlement, ELIGIBLE/SELECTED/FULFILLED, suspension flag |
| quest_events | Append-only activity and transition history |
| operator_actions | Append-only action, operator label, reason and request reference |
| action_requests | Durable idempotency input/result records |
| rate_limits | Shared PostgreSQL-backed abuse controls |
| schema_migrations | Versioned schema installation record |

Completion, eligibility and audit use one transaction. Staff transitions lock participation before reward rows. Recovery serializes by player and commits token consumption, session revocation and new session creation together. Original history and fulfilled entitlements have database immutability triggers. Read views use consistent snapshots.

The session cookie is HttpOnly, SameSite=Lax, Secure in production, and valid for 90 days. Operator authority expires after eight hours. Recovery links expire after 20 minutes. The public Player ID is never an authentication credential. Shared staff initials remain self-reported attribution.

### Routes

| Method | Route | Purpose |
|---|---|---|
| GET | /healthz | Process/database health without secrets |
| GET | / | Redirect to starting quest |
| GET, POST | /start/:slug | Show entry, create/resume player and enroll |
| GET, POST | /intro/:slug | Text/video introduction, retry-safe viewed record |
| GET | /me | Persistent player profile |
| POST | /me/email | Send verification email |
| GET, POST | /recover | Request email recovery |
| GET, POST | /auth/token | Show confirmation, verify/consume email token |
| POST | /logout | Sign out |
| GET, POST | /admin/login | Shared staff login plus operator label |
| GET | /admin | Search players |
| GET | /admin/players/:id | Current state and audit |
| POST | /admin/players/:id/complete | Atomic completion/eligibility |
| POST | /admin/players/:id/reward | Select or confirm fulfillment |
| POST | /admin/players/:id/correct-quest | Correct completion with reason |
| POST | /admin/players/:id/correct-reward | Correct selection or record fulfilled exception |
| POST | /admin/logout | Remove operator authority |
| GET | /assets/styles.css | Mobile stylesheet |

### Source layout

```text
quest-player/
  src/               app, config, database, domain, mailer, security, server, views
  public/            mobile stylesheet
  migrations/        domain schema, auth schema, intro deduplication
  scripts/           migrate, QR, backup/restore, expiry cleanup, local PostgreSQL
  test/              integration, resilience regression, browser journey
  docs/              architecture, identity, quest model, staff/operations guides
  Dockerfile
  compose.yaml
  render.yaml
  .env.example
  README.md
  DEPLOYMENT.md
  AUDIT_V01.md
```

## Verification

The final combined configuration, integration and resilience suite passed all 22 tests (20 substantive scenarios and two parent tests), with no failures or skips. It passed again from an independent clean Git clone. Tests use real PostgreSQL; the primary suite sends through an actual local SMTP server. The full mobile Chrome journey, Docker build/runtime, clean npm start and an actual database restart also passed. [Final validation record](docs/VALIDATION.md).

An actual backup → restore → comparison succeeded against populated test data. All 13 public tables matched by row count and full-row fingerprints, including three players, four participation records, two reward records, 16 quest events and 11 operator audit actions. An application smoke check on the restored database confirmed completion, fulfillment, audit history, health and starting route. [Restore evidence](docs/BACKUP_VERIFICATION.json).

Resolved issues include a schema/query mismatch, overly strict shared-IP limits, lost-response signup access, recovery session atomicity, token concurrency, and invalid-Unicode CSRF handling. Actual browser testing also identified that Referrer-Policy=no-referrer caused a null Origin on form POSTs; strict-origin now preserves CSRF compatibility without exposing URL paths or tokens in referrers.

## Local launch

Install Node 24 and start Docker Desktop, then run in the repository:

```powershell
npm ci
Copy-Item .env.example .env
# Replace SESSION_SECRET and MISSION_CONTROL_PASSPHRASE in .env.
docker compose up -d
npm run migrate
npm start
```

Open http://localhost:3000/start/as-above-so-below. Staff use http://localhost:3000/admin. Local verification/recovery messages are captured at http://localhost:8025. [README](README.md) includes the exact test-player journey and alternatives for an existing PostgreSQL service.

## Render requirements

Connect the repository to Render and apply render.yaml. It declares a Docker web service and PostgreSQL 18 database. Use npm run migrate as the pre-deploy command, npm start as the container command, and /healthz as the health-check route. Required operator settings: stable HTTPS PUBLIC_BASE_URL, generated SESSION_SECRET, long MISSION_CONTROL_PASSPHRASE, SMTP_HOST/PORT/SECURE/USER/PASS and MAIL_FROM. Render supplies DATABASE_URL and PORT. Store the external intro URL/text in quests. R2_PUBLIC_BASE_URL records the media origin and does not upload assets.

Before use with attendees: prove delivery to a real inbox and recovery on another browser; test representative festival connectivity/load; validate hosted backup/restore and the deployed container; upload final content; generate and physically scan the permanent QR. Existing local restore evidence satisfies the implementation drill, not the future hosted service's backup policy.

## Accepted limits

Online only. No lottery algorithm, inventory allocation, physical puzzles, individual staff accounts, email-address change/merge workflow, or proof of one account per person. Staff still need to coordinate the physical handoff; database deduplication cannot undo two pieces physically handed over by two people. Expired auth/rate-limit records can be cleaned with npm run cleanup; audit and idempotency history are retained.

Next implementation step: connect real hosting/email/media configuration and validate the deployed service, while the separate design workstream develops the approved intro, visual identity and physical-to-digital handoff experience.
