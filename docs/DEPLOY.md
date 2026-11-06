# Deploy notes

## Secrets
The Worker reads these three secrets by name, the same names the old `rsma` Worker uses:

| Name | Use |
|---|---|
| `ROBLOX_CLIENT_ID` | Roblox OAuth app |
| `ROBLOX_CLIENT_SECRET` | Roblox OAuth app |
| `SESSION_SECRET` | Key that signs the session cookie (HMAC-SHA256). Changing it signs everyone out. |

Plain variable in `wrangler.toml`: `INITIAL_ADMIN_ROBLOX_ID` (242304445), the Roblox user that becomes admin on first sign-in while no admin exists.

Secrets are never written in `wrangler.toml`. Secrets set in the dashboard or with `wrangler secret put` stay in place across `wrangler deploy`. Plain `[vars]` in the config do overwrite dashboard variables, which is why none are set there.

## Roblox redirect URI
`https://<site>/api/auth/roblox/callback`. This is the path the old site used, so for `rsma.euno.cc` the URI already registered in the Roblox Creator Hub keeps working.

## Cutting over from the old `rsma` Worker
Secrets live on the Worker named `rsma`, so `wrangler.toml` uses that name and Flagman inherits them. Deploying replaces the old site. The old Durable Object class `RaceControlDO` is deleted by migration `v2`, and Flagman uses its own D1 database `flagman` (the old `rsma-d1` is not used).

Cloudflare Workers Builds on the repo: build command `npm run build`, deploy command `npx wrangler deploy`. D1 migrations are not applied by a deploy; after adding a file in `migrations/`, run `npx wrangler d1 migrations apply flagman --remote`.
