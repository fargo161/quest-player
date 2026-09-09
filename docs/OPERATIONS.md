# Festival operations

## Before opening

- Confirm the final printed QR opens the intended quest over mobile data.
- Create a new player, note its QP Player ID, return in the same browser, verify email, and recover that same account in another browser through a real delivered email.
- Test Mission Control using the shared secret and an operator name/initials. Operator labels are attribution, not individually verified authentication. Keep the secret among authorized staff.
- Complete a test quest; confirm ELIGIBLE, then SELECTED, then FULFILLED with the handoff confirmation. Verify repeated requests do not repeat an effect and inspect the audit.
- Correct a test completion and selection with a reason. Confirm original history persists. A fulfilled item stays fulfilled; corrections record exceptions.
- Test text/Continue with an unavailable video. Confirm failed online actions show an error and can be retried. There is no offline mode.
- Perform and retain a successful backup → fresh restore → row and audit verification report, followed by an isolated restored-app smoke check. Record who performed it and when.
- Agree who owns outages, SMTP delivery, backups, staff-secret distribution, and post-event personal-data retention.

## At the desk

Ask the attendee to show the signed-in profile. Search by Player ID when possible; nicknames can repeat. Check nickname, Player ID and reward state together. Quest completion grants eligibility only. Mark SELECTED when that person has been chosen. Mark FULFILLED only after the physical handoff and explicit identity/state confirmation.

A public Player ID is neither a password nor proof that the person owns an account. These checks reduce wrong-account mistakes; they do not enforce one human per account. Do not disclose or change email based solely on a nickname or Player ID.

If the network fails, pause the digital handoff workflow and use the event lead's operational decision. Retry after connectivity returns; refresh the record before another action. Do not assume an error means nothing was committed. Request IDs make repeat submissions safe.

## Mistakes and exceptions

Use the correction action with a specific reason and your operator label. Do not delete records or manually edit state to conceal a mistake. Correcting completion returns it to ACTIVE and suspends unfulfilled eligibility. A fulfilled reward stays fulfilled and records an exception; software cannot reverse the physical handoff. Contact the event lead if the physical state differs from the recorded history.

## Recovery and incidents

Only verified email supports email recovery. Players without verified email may lose access if their browser session is lost. A shared public ID cannot recover access. Recovery email failures need SMTP delivery investigation without copying raw tokens into tickets or logs.

During an outage check `/healthz`, Render logs, PostgreSQL connectivity and SMTP separately. Do not expose secrets, email tokens or database URLs in incident reports. Preserve evidence of completed operations. Rotate compromised staff credentials deliberately and have staff sign out/in. If session signing material is compromised, rotate it with an account recovery communication plan.

Store the last successful restore report privately. Keep the production hostname and database durable across events. New quests attach to existing player records; do not reset players for the next event.
