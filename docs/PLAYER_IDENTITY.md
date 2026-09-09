# Player identity and recovery

## Permanent identity

`players.id` is a UUID. `players.public_id` is a unique QP-XXXXX reference for staff. Neither it nor the nickname is an authentication credential. Duplicate nicknames are allowed. Unique public references are generated with collision retries against the database constraint.

The browser receives a random 256-bit opaque session cookie before entry. When it creates a new player, that already-random session is bound to the newly created identity. The server keeps the original cookie on signup so a lost response cannot strand the player: retry or /me resumes the same account. This does not attach an existing identity by nickname or public ID. Admin login and account recovery rotate sessions.

Sessions are stored in PostgreSQL using HMAC-SHA256 token hashes under SESSION_SECRET. Cookies are HttpOnly, SameSite=Lax, Secure in production, scoped to the host and root path, and expire after 90 days. Admin authority expires after 8 hours. Session lifetime is fixed, not sliding. Database and app restarts retain sessions when the database and SESSION_SECRET are preserved. Changing SESSION_SECRET invalidates existing sessions and emailed tokens.

## Verified email

Entry requires a nickname only. A signed-in player may request verification from /me. A pending email exists on its token record and is not attached to the player until confirmation. A verified email is unique case-insensitively. A verified address cannot be changed in V0.1; account merging is not implemented.

Verification links must be opened and confirmed in the existing player browser, preventing someone from linking an unsolicited address to a different session. Links are 256-bit random secrets, stored hashed, expire after 20 minutes, and require CSRF-protected POST confirmation. GET does not consume them, helping with email scanners. Outgoing URLs use configured PUBLIC_BASE_URL, never an untrusted Host header. Responses use no-store and strict-origin referrer policy, so token paths and query strings are never included in referrers.

## Recovery

/recover accepts a previously verified email. The response is the same for known/unknown addresses. SMTP delivery is real; local tests use an SMTP capture server. Request rate limits are stored in PostgreSQL and include a per-address ceiling. No token is printed in server logs.

The token handler serializes per player, validates and consumes unused links, revokes prior player sessions, creates the replacement session, and commits as one transaction. Cookie activation follows commit. If a response is lost after commit, the player can request another email; the permanent identity remains intact. A network interruption can never prove successful receipt of a cookie, so this recovery retry may be needed.

Without verified email, there is no cross-browser recovery. UI communicates this before entry and on the profile. Player ID and nickname never bypass authentication. Recovery by staff assertion is intentionally absent.

## Security and operational limits

There is no proof of one account per person. Verified email proves control of that mailbox only. Staff labels are attribution, not individual authentication. Production requires a stable HTTPS hostname, appropriate secret storage, provider SMTP TLS and sender setup. Rate limits allow generous shared-network traffic but must be reviewed against actual event attendance. No load-capacity claim is made.

Expired record cleanup is available in `npm run cleanup`. Audit and player retention policies are operator decisions; this release provides no public deletion/merge workflow. Backup files contain personal and authentication records and must be protected.
