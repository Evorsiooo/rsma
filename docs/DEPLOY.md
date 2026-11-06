# Deploy notes

## Secrets
The Worker reads these three secrets by name, the same names the old `rsma` Worker uses:

| Name | Use |
|---|---|
| `ROBLOX_CLIENT_ID` | Roblox OAuth app |
| `ROBLOX_CLIENT_SECRET` | Roblox OAuth app |
| `SESSION_SECRET` | Key that signs the session cookie (HMAC-SHA256). Changing it signs everyone out. |

Optional plain variable: `INITIAL_ADMIN_ROBLOX_ID`, the Roblox user id that becomes admin on first sign-in while no admin exists.

Secrets are never written in `wrangler.toml`. Secrets set in the dashboard or with `wrangler secret put` stay in place across `wrangler deploy`. Plain `[vars]` in the config do overwrite dashboard variables, which is why none are set there.

## Roblox redirect URI
`https://<site>/api/auth/roblox/callback`. This is the path the old site used, so for `rsma.euno.cc` the URI already registered in the Roblox Creator Hub keeps working.

## Cutting over from the old `rsma` Worker
Secrets live on the Worker named `rsma`, so Flagman has to deploy under that name to inherit them (`name = "rsma"` in `wrangler.toml`). Deploying replaces the old site, and the old Durable Object class `RaceControlDO` needs a delete migration (`deleted_classes`) in the same deploy. The old D1 database `rsma_d1` is not touched; Flagman uses its own database.
