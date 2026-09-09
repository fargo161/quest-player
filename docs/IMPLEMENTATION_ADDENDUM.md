# Frozen V0.1 implementation addendum

This addendum incorporates the user's September 9, 2026 decisions and supersedes conflicting choices in the original master prompt. Build a new project, `quest-player`; do not modify the old QR router. Creative quest mechanics and final event assets are separate work.

- Working SMTP email verification and recovery, with single-use expiring secrets. Nickname-only entry is allowed. Explain that without verified email losing a session may lose account access.
- Permanent UUID and unique public `QP-XXXXX` reference. The reference is never a credential.
- Participation: absent, ACTIVE, COMPLETED.
- Glass: ELIGIBLE, SELECTED, FULFILLED. Completion grants eligibility; staff selection and physical handoff are separate actions.
- Corrections preserve original audit history, actor label, timestamp and reason. A fulfilled reward remains fulfilled; record exceptions rather than claiming physical reversal.
- Shared Mission Control secret with self-reported operator name/initials. This is attribution, not individual authentication.
- Staff confirm nickname, Player ID, and reward state before handoff. No claim of one account per person.
- Completion, reward grant, domain events and operator audit are atomic. Selection and fulfillment are atomic with their audit. Mutations are safely retryable.
- Online only. Text and Continue remain usable when video fails.
- Demonstrate backup, restore, and verification before claiming festival readiness.
- Node 24 LTS, Express, PostgreSQL, Docker, Render; external media URLs support R2. Production email, hostname and infrastructure require real operator configuration.

## Execution plan

1. Inventory and agree data/service contracts.
2. Implement transactional domain, player/recovery flow, Mission Control, and deployment support in bounded parallel tasks.
3. Integrate and test with real PostgreSQL and local SMTP capture, including simultaneous requests and corrections.
4. Adversarial audit, clean installation and backup/restore verification. Report actual evidence and external launch prerequisites.

## Initial inventory

The task directory contained only empty work/output directories and was not a Git repository. No applicable AGENTS.md was found in the checked task ancestors. Node v24.18.0 and npm 11.16.0 are available. At initial inventory the Docker CLI was available but its engine was stopped; subsequent local validation started Docker Desktop and exercised the image. PostgreSQL tools are not on PATH. No existing application is being overwritten.

## Confirmed live setup boundaries and content extension

Art Park's existing Render service and PostgreSQL database are reference-only. Quest Player uses a separate service and database. Never reuse, connect this app to, migrate, restore into, or modify the Art Park database. Reuse infrastructure patterns only. No Quest Player custom domain or email delivery provider is configured. Existing R2 usage provides precedent, not authorization to modify existing buckets. Live resource IDs and credentials are intentionally unspecified.

Mission Control now includes state content editing at `/admin/content`. For participation NONE/ACTIVE/COMPLETED and reward ELIGIBLE/SELECTED/FULFILLED, staff can configure a title, plain text, HTTPS image URL with alt text, and HTTPS video URL. Participation and reward content are separate categories; actual database state selects what players see. Editing content cannot grant completion, selection, or fulfillment. No additional scan is required.

Content saves atomically retain operator attribution and immutable revision history, reject stale versions, and use request IDs for safe retries. Empty text uses the existing fallback copy. Missing media must never block progress. This extension supersedes earlier limitations requiring direct SQL or omitting a content editor; it does not decide the physical quest or final creative assets.

