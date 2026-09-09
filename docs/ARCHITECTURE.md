# Architecture

Quest Player is an online Node 24 / Express application backed by PostgreSQL. Render hosts the HTTP service; R2 may host introduction videos through configured public URLs. The database contains identities, durable sessions, recovery secrets, participation, rewards, and audit history. Creative quest mechanics are outside this foundation.

`players.id` is permanent. The unique human-readable `public_id` identifies a player to staff and is never accepted as an authentication secret. Email is optional; only verified control supports recovery. Shared staff authentication attributes actions to a supplied operator label, not a separately authenticated employee.

## Transaction boundaries

`src/domain.js` owns participation and reward operations. Enrollment inserts one participation and one enrollment event in one transaction. Completion locks participation, marks completion, grants or restores associated reward eligibility, and appends quest and staff histories in one transaction. Reward changes lock that same participation before locking a reward. This fixed order serializes completion, correction, selection, and fulfillment for a player/quest without deadlocks between those paths.

Each staff mutation requires a random request UUID. `action_requests` stores its full semantic input and committed result. A concurrent duplicate insert waits for the first transaction; an identical retry receives its result, while reused keys with different input return a conflict. Failed transactions roll back their request record so safe retries can execute. State checks protect against duplicates submitted with different keys. Idempotency records are durable and must not be casually purged.

Database constraints enforce one participation per player/quest, one entitlement per player/reward, valid state/timestamp combinations, and foreign keys. Triggers prevent updates/deletes to history and modification/deletion of fulfilled entitlements. The application is the supported write boundary for cross-table state transitions. Database administrators still have power to change schema/triggers; these controls are not tamper-proof against privileged administrators.

Profiles read participation, rewards, and history from a single repeatable-read snapshot. Public nickname search returns at most 50 staff-visible candidates; staff must match nickname and Player ID before an action. Email is not used as public search data.

## Operational boundaries

There is no offline queue or local authority over reward state. A failed HTTP response may hide a committed action, so the form's request UUID must be retained when retrying. Video failure cannot block the text introduction or Continue action. Backups must include all application tables, including sessions, idempotency records, and audit history. An actual restore and verification are required before festival readiness; see deployment and backup documentation for execution evidence and procedures.

The UI is a functional foundation. The initial seeded introduction does not invent physical objectives, prize counts, or final event content.
