# Quest Player — V0.1

A small persistent player foundation for As Above So Below and future physical quests. This is a working infrastructure skeleton; the physical puzzles and final event presentation are separate work.

## What it does

A player enters a nickname, receives a permanent UUID and public `QP-XXXXX` Player ID, and joins a quest. A durable browser session keeps them signed in. They can verify an optional recovery email and later recover the same account on another browser. Staff search by nickname or Player ID, confirm completion, select an eligible player for glass, and record physical handoff.

Participation: no record → ACTIVE → COMPLETED. Glass: ELIGIBLE → SELECTED → FULFILLED. Corrections preserve the original audit trail. Fulfilled glass remains fulfilled, with an exception record where needed.

See [the frozen implementation addendum](docs/IMPLEMENTATION_ADDENDUM.md), [architecture](docs/ARCHITECTURE.md), [identity](docs/PLAYER_IDENTITY.md), [quest model](docs/QUEST_MODEL.md), [staff guide](docs/MISSION_CONTROL.md), and [audit](AUDIT_V01.md).

## Local setup (Node 24 + Docker Desktop)

Run from this repository. Start Docker Desktop first. PostgreSQL 18 and a local email inbox run in containers; the app runs directly in Node.

```powershell
npm ci
Copy-Item .env.example .env
docker compose up -d
npm run migrate
npm start
```

Replace the two example session/staff secrets in `.env` with your own random values. Generate a secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Never commit `.env`. Open http://localhost:3000/start/as-above-so-below. The local email inbox is http://localhost:8025; it captures mail instead of delivering it to the internet.

With an existing PostgreSQL service, set `DATABASE_URL` in `.env`, supply SMTP settings, and omit `docker compose up -d`. Docker is not required to run the application. A workspace-local PostgreSQL helper is also available with `npm run db:local`; see its environment options in `scripts/local-pg.js`. It is a development convenience, not the production database.

## Create and complete a test player

1. Open `/start/as-above-so-below`, enter `Test Player`, and continue through the introduction to `/me`.
2. Note the player's `QP-XXXXX` reference. Optionally add email, then open the captured verification link in the same browser and confirm.
3. In another browser profile, open `/admin`. Enter your operator name/initials and the `MISSION_CONTROL_PASSPHRASE` from `.env`.
4. Search for Test Player and confirm their Player ID. Mark the quest completed.
5. Refresh the player profile: COMPLETED and ELIGIBLE appear.
6. In Mission Control, record selection. At the actual handoff, check nickname, Player ID and SELECTED state, check the confirmation box, then record FULFILLED.
7. Use the correction controls with a reason to test audit preservation. A fulfilled handoff cannot be reversed digitally.

No account-to-person uniqueness is claimed. Operator labels are self-reported under a shared password.

## Email recovery

Real SMTP delivery is implemented with Nodemailer; it is not a stub. For real inboxes configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`. Production requires authenticated SMTP and TLS. Provider credentials and sender-domain verification must be set up externally.

Verification must be confirmed in the existing player browser. Recovery can be confirmed in a new browser and revokes prior sessions for that player. Links expire after 20 minutes and are single-use. GET only shows a confirmation; POST consumes the link. See [identity details](docs/PLAYER_IDENTITY.md).

## State content and media

In Mission Control, choose **Edit player content** at `/admin/content`. Select the quest and one of its six slots:

- Participation: NONE (before joining), ACTIVE, COMPLETED.
- Rewards: ELIGIBLE, SELECTED, FULFILLED.

Edit a title, plain text, optional HTTPS image URL with description, and optional direct HTTPS video URL. Enter a reason and save. Changes appear when the player opens or refreshes the relevant page. A completed player sees COMPLETED quest content alongside their independent reward-state content. Suspended rewards show their standard paused explanation without reward-specific media. No mid-quest scans are needed.

The server chooses content from persisted participation/reward state. Editing content cannot grant completion or rewards. Saves are atomic with an immutable revision, operator initials, reason and request reference. Concurrent stale edits return a conflict rather than overwriting a newer version. Blank fields clear the corresponding content; standard instructions and Continue remain available even if media fails. Existing intro text/video are copied into ACTIVE content by migration004.

Upload media separately and paste its public HTTPS R2/CDN URL. This is a small content editor, not an upload service or a full CMS. `quest_content` is the content source of truth; `content_revisions` keeps old snapshots. Legacy `quests.intro_*` fields are fallback/migration inputs for newly added quests, not the ongoing editor. `R2_PUBLIC_BASE_URL` documents the media origin and does not rewrite URLs.

## Production QR

First configure a permanent HTTPS `PUBLIC_BASE_URL`. Then deliberately confirm its hostname:

```powershell
npm run qr -- --confirm-host quest.your-domain.example --output qr-output
```

Use your actual hostname, not the example. The command generates PNG and SVG for `/start/as-above-so-below` and records the destination. It rejects localhost, temporary tunnel domains and mismatched confirmation. No production QR has been generated for this deliverable because no permanent hostname has been supplied.

## Tests

Integration tests create uniquely named databases on the supplied PostgreSQL service. Use a disposable local service and a role with CREATEDB privilege. They retain evidence databases; they never overwrite an existing database. Test SMTP mail is captured in-process, with no messages sent to real recipients.

```powershell
$env:TEST_DATABASE_URL = 'postgresql://quest:local-development-only@127.0.0.1:5432/quest_player'
npm test
npm run test:browser
```

Browser tests use installed Chrome through `CHROME_PATH` or Playwright Chromium. If needed install it with `npx playwright install chromium`. Integration covers duplicate participation, concurrency, recovery, CSRF, permissions, corrections, immutable history, rollback, and a hypothetical second event in a test database only.

## Backup verification

Use PostgreSQL 18 client tools (`pg_dump`, `pg_restore`, `createdb`). Set `PG_BIN` if they are not on PATH. The restore drill creates a fresh database, restores the dump, and compares all public-table row counts and fingerprints against the same source snapshot.

```powershell
npm run backup:verify -- --output C:\private\quest-backups
```

Choose your own private backup directory. Dumps include account data and session records. The tool retains both the dump and verification database for deliberate inspection/cleanup. [Operations guide](docs/OPERATIONS.md) explains the procedure. A real local drill was performed; this is not proof of a future hosted database's backup policy.

## Render deployment

See [DEPLOYMENT.md](DEPLOYMENT.md). The repository includes a non-root Node 24 Dockerfile and a Render Blueprint for the web app plus PostgreSQL. `npm start` respects `PORT`; `/healthz` checks database connectivity. Run `npm run migrate` as the pre-deploy command. Configure the permanent HTTPS origin, secrets and working SMTP credentials in Render. Upload media to R2 separately.

Art Park already exists on Render as a reference only. Do not reuse, connect to, migrate or modify its database. Provision separate Quest Player service/database resources. No custom domain or email delivery provider is configured yet; R2 is precedent only. See [live setup boundaries](docs/LIVE_SETUP.md). This repository has not been deployed to Render, connected to a real sender domain, or assigned a permanent hostname. The Docker image was built and tested against a fresh PostgreSQL 18 container; non-root execution, PORT override, migrations and health/entry routes passed.

## Maintenance and boundaries

Run `npm run cleanup` periodically to remove expired sessions, email tokens and rate-limit rows. It preserves player records, permanent history and action deduplication records. Back up before upgrades and verify restoration routinely. Migrations are versioned and serialized with a database advisory lock.

The system requires connectivity. It does not implement offline play, physical puzzles, a lottery algorithm, inventory allocation, individual staff accounts, email changes, or account merging. It makes important actions safely retryable and leaves creative experience design to the separate workstream.
