# Flagman

Race control for Roblox rally and time-trial events: public timing, steward panel, driver radio pop-out, team panel and admin. Rebuild of the RSMA site. The previous code is on the `archive/old-site` branch.

## Stack
Cloudflare Worker (Hono) + Durable Object per race + D1, Roblox OAuth. Client is Vite + React + TypeScript using the UI kit in `src/kit` unchanged (see `src/kit/KIT-README.md`, `PARTS.md`, `MOTION.md`).

## Develop
```
npm install
npm run db:local                                   # create local D1 tables
npx wrangler d1 execute flagman --local --file=scripts/seed-dev.sql   # optional sample event
npm run dev                                        # client + worker on :5173
npm run typecheck
```

## Layout
- `src/` client, `src/kit/` the UI kit (do not restyle; add parts there only when the kit lacks one)
- `worker/` API and Durable Objects, `shared/` types used by both, `migrations/` D1 schema
- `docs/` architecture notes and `FUTURE.md` (features deliberately not built yet)

## Local sign-in
Copy `.dev.vars.example` to `.dev.vars`. To try sign-in without Roblox, run any server that answers `/oauth/v1/authorize`, `/token` and `/userinfo` and set `ROBLOX_OAUTH_BASE` to it. Event data is created from the steward panel.
