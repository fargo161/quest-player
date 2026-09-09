# Quest Player live setup

The application is being prepared locally. These steps describe the remaining operator setup; they are not a record that remote resources exist or that deployment has happened.

## Keep Art Park separate

Art Park already has a Render service and PostgreSQL database. They are references for familiar infrastructure patterns only. Quest Player requires its own Render service and its own PostgreSQL database. Do not connect Quest Player to the Art Park database, copy its connection string into Quest Player, run Quest Player migrations there, restore into it, or modify it. The old QR router is also outside this implementation.

The supplied `render.yaml` proposes names `quest-player` and `quest-player-db`. These names are not verified live resource IDs. The blueprint's DATABASE_URL reference points to its new Quest Player database. Before the first migration or restore, verify the actual database's identity through the intended Quest Player resource settings without posting the secret URL in chat or logs.

## What still needs configuration

| Item | Current fact | Needed for launch |
| --- | --- | --- |
| Render | Art Park is an existing reference | Separate Quest Player service and PostgreSQL database |
| Public URL | No custom domain configured | Deliberately chosen stable HTTPS Quest Player origin, set as PUBLIC_BASE_URL |
| Email | No email delivery provider configured | Real SMTP provider, authenticated sender, delivery verification |
| R2/media | Existing R2 use is precedent | Separately authorized public HTTPS Quest Player assets and tested URLs |
| Content | Mission Control state editor is available in the implementation | Final approved copy and assets for relevant state slots |
| Backups | Local restoration tests are development evidence | Equivalent drill against the intended live setup and representative data |

An actual final Render-provided HTTPS hostname can be used if deliberately chosen as the lasting public origin; a custom domain is a separate choice. Do not invent a hostname or generate print-ready QR codes before that choice is final. Never point Quest Player at the Art Park origin.

## Setup sequence

1. Select the project repository and provision separate Quest Player resources using the blueprint. Check service/database names and paid resource choices before creating them.
2. Set the final HTTPS PUBLIC_BASE_URL, a random SESSION_SECRET, and a separate MISSION_CONTROL_PASSPHRASE. Keep secrets in the service environment, not source control.
3. Choose an SMTP delivery provider and set SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS and MAIL_FROM. The local Mailpit inbox does not deliver mail to attendees. Complete any sender-domain verification with the provider.
4. Verify DATABASE_URL is the new Quest Player database before enabling the pre-deploy migration command. Run migrations and confirm `/healthz` works. Do not experiment against Art Park.
5. Prepare media in separately authorized storage. R2 is supported through public HTTPS media links; this app does not provision buckets or upload files. Do not modify existing buckets merely because Art Park uses R2.
6. Log into Mission Control with a staff label, open `/admin/content`, and configure participation NONE/ACTIVE/COMPLETED and reward ELIGIBLE/SELECTED/FULFILLED. Each slot supports title, plain text, image URL/alt text and video URL. State content follows authoritative participation/reward records and cannot award anything.
7. Exercise signup, verified email, another-browser recovery, completion, selection, handoff and audited corrections. Test failed media and retry behavior. Confirm mobile access over cellular data.
8. Perform backup → fresh restore → row/audit verification and an isolated restored-app smoke test for the intended environment. Inspect and retain the evidence privately. Never use Art Park as the restore destination.
9. Generate the QR with explicit confirmation of the final hostname, then scan a printed proof. Finalize staff handoff procedures and operational ownership before admitting attendees.

See [Deployment](../DEPLOYMENT.md) for commands and [Operations](OPERATIONS.md) for the desk workflow. A successful local test does not establish real SMTP delivery, domain configuration or production availability.
