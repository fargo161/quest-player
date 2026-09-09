# V0.1 implementation audit

Reviewed September 9, 2026. Scope: application routes, session/recovery security, PostgreSQL domain model, UI integration, and the integration test source. This is an implementation review, not a penetration-test certification or live-event approval.

## Evidence and limits

The integration runner reported **16 passing tests: 15 scenario subtests plus their parent test**. The suite uses a fresh real PostgreSQL database and a local SMTP server; it is not an in-memory database or a mail-function stub. The reviewer inspected the scenario source and independently checked the security module syntax and Unicode comparison behavior. The full integration suite execution was performed by the coordinating agent.

The reviewer subsequently ran `test/robustness.test.js` against its own fresh PostgreSQL database: **5 passing tests: four regression scenarios plus their parent**. These independently demonstrate lost-signup-response retry, simultaneous distinct recovery tokens, rollback of failed recovery session insertion, and old completion replay after a correction. This focused suite injects a no-op mailer because SMTP delivery is already covered by the main suite; its recovery tokens are inserted directly into the test database. Combined evidence comprises 19 scenario subtests, not 21 distinct scenarios. The expected `P0001` error log is the intentionally injected session failure.

Covered scenarios include clean repeatable migrations, health/static routes, nickname signup and intro retries, duplicate nicknames, HTML escaping, CSRF and authorization, simultaneous completion, simultaneous fulfillment, correction history and suspension, conflicting idempotency payloads, SMTP delivery and single-use verification, cross-browser recovery and prior-session revocation, application recreation with retained cookies, expired tokens, email throttling, injected audit failure rollback, reuse at another event, and staff logout.

These tests do not establish browser rendering, production mail deliverability, real mobile festival connectivity, capacity under event load, or container deployment correctness. Render deployment and external SMTP/R2 setup have not been demonstrated. Docker evidence was added after this audit pass. Backup/restore verification is being documented separately by the deployment workstream; do not infer its completion from this report.

## Resolved findings

| Severity | Finding and resolution |
| --- | --- |
| Blocker | Intro POST referenced nonexistent schema fields. Route now writes the actual domain columns; a partial unique index makes repeated intro events safe. |
| High | Original shared-IP signup/verification/recovery limits were too low for festival Wi-Fi. Those routes now have larger IP ceilings; token confirmation uses a 3000/hour IP ceiling plus 20/hour per session. These defaults still need event-scale validation. |
| High | Recovery originally consumed the token before creating its session. Session issuance now occurs inside the token transaction, and cookie activation occurs after commit. Recovery revokes previous player sessions. |
| Medium | Non-ASCII CSRF values could cause a timing-safe comparison exception. Comparison now checks UTF-8 buffer lengths and returns a normal rejection. |
| Medium | Stylesheet URL and UI validation bounds disagreed with routes/domain. Coordinated UI fixes align these contracts. |
| High | Signup deleted the original browser session before its replacement cookie could reliably arrive. Signup now retains the securely generated existing session while binding the new player. The original cookie reaches the same account after an ignored response and concurrent retries. |
| Medium | Distinct recovery tokens could lock separate rows and deadlock while consuming all tokens. Token processing now locks the player before revalidating/locking the token. The regression test confirms one success and one normal rejection without a 500. |

## Remaining release gaps

No unresolved blocker or high-severity implementation finding remains from this bounded review after the regression fixes. This is not a claim that all possible defects were ruled out. Capacity, production deployment, actual remote email deliverability, and hosted backup operation remain release evidence gaps. Local mobile, container, clean-clone and restore checks were subsequently completed; see docs/VALIDATION.md. Refer to the final verification and deployment reports for work completed after this review.

## Important semantics and accepted limits

- An old idempotency request returns its original committed result and never reapplies the mutation, even after a later correction. The web route then redirects to the current record. A deliberate new action requires a newly rendered form/request ID; replaying old completion must not undo a correction.
- Signup uses a row lock so simultaneous submissions that see the same session cannot create two players through that session. It retains the existing randomly generated session cookie; admin authentication and recovery still rotate credentials.
- One fulfillment row and one audit transition prevent duplicate database fulfillment; they cannot prevent two staff members physically handing over two objects before either checks the latest result. Staff must coordinate the actual handoff and inspect current state. No inventory cap or one-human-one-account guarantee is implemented.
- Shared staff credentials and operator initials provide attribution, not individual authentication. Staff labels are self-reported. Corrected completion suspends non-fulfilled rewards; recompletion resets them to eligible and requires a new selection. Fulfilled glass stays fulfilled, with exceptions preserved.
- A database transaction can commit even if its response is lost. Staff mutations remain safely replayable with the same request ID. Recovery can request another email after a lost successful response; the database transaction cannot guarantee delivery of a browser cookie.
- Email verification must be confirmed in the original player browser. Email changes are intentionally unavailable. Sessions have a fixed 90-day expiry, and staff privileges expire after eight hours.
- Rate-limit, session, and token tables have an explicit cleanup script (`npm run cleanup`); operators must arrange its schedule. Expired rows are ignored until cleanup. Idempotency and audit history must not be casually purged.

**Assessment:** The tested transactional foundation is credible, and the identified signup/token defects are fixed with regression coverage. Complete external deployment, operational validation, and restore evidence before describing the system as festival-ready.

## Final integration additions

Actual mobile Chrome testing exposed a form Origin mismatch caused by Referrer-Policy=no-referrer. The application now uses strict-origin: it excludes secret URL paths/queries from referrers while allowing the expected same-origin form POST. The full mobile player/staff journey subsequently passed. A real backup and restore compared all 13 public tables successfully, followed by an application smoke check against the restored data. See docs/VALIDATION.md for final combined test, container and clean-install evidence.
