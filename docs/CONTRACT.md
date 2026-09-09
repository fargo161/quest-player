# Implementation boundaries

ES modules, Node 24. PostgreSQL queries via `pg`. Root owns package.json, app/auth/config/db and integration tests. Domain agent owns migrations and src/domain.js. UI agent owns src/views.js and public/. Deployment agent owns Docker/deploy/QR/backup scripts and deployment docs.

## Database contract

Use UUID ids provided by Node or `gen_random_uuid()`, timestamptz dates. Tables: players(id, public_id unique, display_name, email nullable, email_verified_at nullable, created_at, updated_at, last_seen_at); events; quests; player_quests; quest_events; rewards; player_rewards; operator_actions. Root creates migration 002 for sessions, email_tokens, rate limits and request deduplication if needed. Domain agent creates migration 001.

Domain exports async functions taking `pool` first: `enroll(pool, playerId, slug)`, `profile(pool, playerId)`, `findPlayers(pool, query)`, `playerDetail(pool, playerId)`, `completeQuest(pool, {playerId, questId, operator, requestId})`, `transitionReward(pool, {playerId, rewardId, target, operator, requestId})`, `correctQuest(pool, {playerId, questId, reason, operator, requestId})`, `correctReward(pool, {playerId, rewardId, target, reason, operator, requestId})`. Domain owns idempotency table if used, and each mutation accepts requestId unique UUID scoped to operator action. Error objects use `.status` HTTP code and `.message` safe display text.

`profile`/`playerDetail` return `{player, participations, rewards, audit}`. Participation rows include quest_id, quest_name, quest_slug, status, started_at, completed_at, intro_video_url, intro_text. Reward rows include reward_id, quest_id, name, status, eligible_at, selected_at, fulfilled_at, suspended (boolean). Correcting completion sets ACTIVE and suspends non-fulfilled rewards; a FULFILLED record stays fulfilled and gains exception history. Recompletion can restore ELIGIBLE for suspended non-fulfilled rewards. Correcting a non-fulfilled reward permits SELECTED -> ELIGIBLE only; fulfilled correction creates an exception audit without changing fulfillment. History retained.

`enroll` returns quest row; quest slug globally unique in V0.1. `findPlayers` returns player rows with id, public_id, display_name. `playerDetail` same profile plus audit ordered latest first. Initial slug as-above-so-below; seed event/quest/reward and text intro, empty nullable video URL. Media resides on quests for simple DB configuration.

## UI contract

src/views.js exports `layout(title, body)`, `startPage({quest, player, csrf, error})`, `introPage({quest, csrf})`, `profilePage({data, csrf, message})`, `recoveryPage({csrf, message})`, `tokenPage({token, purpose, csrf, error})`, `adminLoginPage({csrf, error})`, `adminSearchPage({players, query, csrf, operator})`, `adminDetailPage({data, csrf, operator, message})`, `errorPage({status, message})`. All functions return complete HTML except layout's body argument. Escape all dynamic HTML. Forms include hidden `_csrf`. Import randomUUID in views for hidden `requestId` on every admin mutation.

POST /start/:slug display_name (new only), POST /intro/:slug, GET /me, POST /me/email email, POST /logout, GET+POST /recover email, GET /auth/token?token=...&purpose=verify|recover (confirmation only), POST /auth/token token,purpose, GET+POST /admin/login passphrase,operator, GET /admin?q=..., GET /admin/players/:id, POST /admin/logout. Admin actions: POST /admin/players/:id/complete questId,requestId; /reward rewardId,target (SELECTED|FULFILLED),requestId,confirm (yes on handoff); /correct-quest questId,reason,requestId; /correct-reward rewardId,target (ELIGIBLE|EXCEPTION),reason,requestId. No other admin mutations. Display nickname/ID/state with explicit handoff confirmation. Start GET reads quest (no enrollment); POST creates/enrolls. Intro always permits Continue. CSS external, no inline scripts under CSP. UI is a functional neutral skeleton, no invented physical gameplay.

## Runtime contract

src/config.js exports loadConfig(env=process.env); src/db.js exports createPool(connectionString), migrate(pool). src/app.js exports createApp({pool,config,mailer}) returning Express app; mailer has sendMail({to,subject,text}). src/server.js loads env, validates config, runs HTTP server (migrate separately). `npm start`, `npm run migrate`, `npm test` expected. Environment: DATABASE_URL, SESSION_SECRET, MISSION_CONTROL_PASSPHRASE, PUBLIC_BASE_URL, PORT, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM, R2_PUBLIC_BASE_URL. Node built-in --env-file-if-exists=.env used in scripts.
