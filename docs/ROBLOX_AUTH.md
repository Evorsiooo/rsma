# Roblox OAuth 2.0 Specification & Root Cause Analysis

## 1. Executive Summary

This document provides the canonical, "by-the-book" implementation guide for Roblox OAuth 2.0 / OpenID Connect (OIDC) according to the official [Roblox Creator Documentation](https://create.roblox.com/docs/open-cloud/oauth2-app-implementation), followed by an audit of the current codebase and an explanation of why the application encountered **Cloudflare Error 1015 (`429 Rate Limited`)**.

---

## 2. Roblox OAuth 2.0: Official Specification ("By the Book")

Roblox implements the standard **OAuth 2.0 Authorization Code Flow** with **PKCE (Proof Key for Code Exchange)** (RFC 7636).

### 2.1 Overview of Flow

```
+--------+                               +---------------+
|        |--(A)- Authorization Request ->|   Roblox      |
|        |       (via browser redirect)  | Authorization |
|        |                               |    Server     |
|        |<-(B)- Authorization Code -----|               |
| User   |       (via redirect_uri)      +---------------+
| Browser|
|        |                               +---------------+
|        |--(C)- Send Code to Backend -->|  Our Worker   |
+--------+                               |   Backend     |
                                         +---------------+
                                                 |
                                 (D) POST /oauth/v1/token
                                 (with code + code_verifier)
                                                 v
                                         +---------------+
                                         |    Roblox     |
                                         | Token Server  |
                                         | (Envoy Gateway|
                                         +---------------+
                                                 |
                                 (E) GET /oauth/v1/userinfo
                                 (with Bearer access_token)
                                                 v
                                         +---------------+
                                         | Roblox User   |
                                         | Info Server   |
                                         +---------------+
```

---

### 2.2 Step 1: Authorization Request (`GET /oauth/v1/authorize`)

When the user clicks "Sign In with Roblox", the backend generates:
1. `state`: A cryptographically random string (e.g. 32 bytes base64url) stored in a secure, `HttpOnly`, `SameSite=Lax` cookie. Used to prevent Cross-Site Request Forgery (CSRF).
2. `code_verifier`: A high-entropy cryptographic random string (43–128 characters, unreserved URL characters: `[A-Z]`, `[a-z]`, `[0-9]`, `-`, `.`, `_`, `~`). Stored in the same secure cookie.
3. `code_challenge`: `BASE64URL(SHA256(code_verifier))`.

#### Request Parameters
- **Endpoint**: `https://apis.roblox.com/oauth/v1/authorize`
- **Method**: `GET` (browser redirect)
- **Parameters**:
  - `client_id` (string, required): Your App Client ID from the Roblox Creator Hub.
  - `redirect_uri` (string, required): Exactly matches one of the redirect URIs registered in the Creator Hub (e.g. `https://rsma.euno.cc/api/auth/roblox/callback`).
  - `response_type` (string, required): Must be `code`.
  - `scope` (string, required): Space-separated list of scopes. For sign-in: `openid profile`.
  - `state` (string, required): The random state token.
  - `code_challenge` (string, required for PKCE): The SHA-256 base64url hash of the verifier.
  - `code_challenge_method` (string, required for PKCE): Must be `S256`.

---

### 2.3 Step 2: Handling Callback & CSRF Verification

Roblox authenticates the user and prompts them to grant permissions. If approved, Roblox redirects the user's browser to:
```
GET https://rsma.euno.cc/api/auth/roblox/callback?code=AUTH_CODE&state=STATE_VALUE
```
If denied or cancelled:
```
GET https://rsma.euno.cc/api/auth/roblox/callback?error=access_denied&error_description=...
```

**Verification Steps**:
1. Check for `error`. If present, fail gracefully.
2. Read the `flagman_oauth` cookie to extract `[savedState, verifier]`.
3. Check `state === savedState`. If they do not match or cookie is absent, reject with a CSRF error.

---

### 2.4 Step 3: Token Exchange (`POST /oauth/v1/token`)

The backend sends a server-to-server HTTP POST request to exchange the single-use authorization code for tokens.

#### Official Request Specification
- **Endpoint**: `https://apis.roblox.com/oauth/v1/token`
- **Method**: `POST`
- **Headers**:
  ```http
  Content-Type: application/x-www-form-urlencoded
  ```
  *(Official Roblox docs do NOT require or recommend custom browser User-Agents).*
- **Body** (`application/x-www-form-urlencoded`):
  - `grant_type`: `authorization_code`
  - `code`: The authorization code from Step 2.
  - `client_id`: The App Client ID.
  - `client_secret`: The App Client Secret.
  - `code_verifier`: The plaintext verifier generated in Step 1.
  - `redirect_uri`: Must match the exact `redirect_uri` sent in Step 1.

#### Expected Success Response (`200 OK`)
```json
{
  "access_token": "eyJhbGciOi...",
  "refresh_token": "eyJhbGciOi...",
  "id_token": "eyJhbGciOi...",
  "token_type": "Bearer",
  "expires_in": 899,
  "scope": "openid profile"
}
```

---

### 2.5 Step 4: User Profile Fetch (`GET /oauth/v1/userinfo`)

The backend fetches the authenticated user's Roblox profile using the `access_token`.

#### Official Request Specification
- **Endpoint**: `https://apis.roblox.com/oauth/v1/userinfo`
- **Method**: `GET`
- **Headers**:
  ```http
  Authorization: Bearer <access_token>
  ```

#### Expected Success Response (`200 OK`)
```json
{
  "sub": "242304445",
  "preferred_username": "alphaze1",
  "name": "alphaze1",
  "nickname": "Evorsio"
}
```
*Note*: `sub` is the immutable Roblox User ID (string).

---

## 3. Codebase Audit: Current Implementation vs. Specification

| Area | Official Roblox Specification | Current Code (`worker/auth/index.ts`) | Status |
| :--- | :--- | :--- | :--- |
| **Authorize Endpoint** | `https://apis.roblox.com/oauth/v1/authorize` | `https://apis.roblox.com/oauth/v1/authorize` | **Matches** |
| **PKCE Verifier / Challenge** | 43–128 chars, SHA-256 base64url | 48 chars random, `S256` SHA-256 base64url | **Matches** |
| **Token Endpoint** | `https://apis.roblox.com/oauth/v1/token` | `https://apis.roblox.com/oauth/v1/token` | **Matches** |
| **Token Request Body** | `grant_type`, `code`, `client_id`, `client_secret`, `redirect_uri`, `code_verifier` | `grant_type`, `code`, `client_id`, `client_secret`, `redirect_uri`, `code_verifier` | **Matches** |
| **Token Request Headers** | `Content-Type: application/x-www-form-urlencoded` | **`User-Agent: Mozilla/5.0 (Windows NT 10.0; ...)`** added in `f7f1600` | **NON-STANDARD / HARMFUL** |
| **UserInfo Headers** | `Authorization: Bearer <token>` | **`User-Agent: Mozilla/5.0 ...`** added in `f7f1600` | **NON-STANDARD / HARMFUL** |
| **Access Token Login** | N/A (Custom feature) | Lines 55: `roles: claims.via === "token" ? [] : ...` | **Wipes admin roles** |

---

## 4. Root Cause Analysis: Why Did You Get "Error Code 1015"?

### What is Cloudflare Error 1015?
`Error 1015: You are being rate limited` is an HTTP 429 response generated by Cloudflare's edge security layer before traffic reaches the origin server (Roblox's Envoy public gateway).

Roblox puts Cloudflare edge protection in front of `apis.roblox.com`.

### Why did your requests trigger Error 1015?

1. **The Hardcoded Chrome `User-Agent`**:
   In commit `f7f1600`, the following header was injected into outbound Worker fetch calls:
   ```ts
   const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
   ```
   **Why this is fatal in a Cloudflare Worker**:
   - Cloudflare Workers execute from serverless datacenter IP addresses (AS13335).
   - Cloudflare Workers' `fetch()` uses a standard TLS client implementation, which produces a server-side TLS fingerprint (JA3/JA4).
   - Cloudflare's Bot Management algorithms compare the incoming `User-Agent` with the TLS fingerprint.
   - When a request claims to be a desktop Google Chrome browser on Windows 10/11, but the TLS handshake does not match Chrome's TLS fingerprint and comes from a datacenter IP, Cloudflare WAF flags it as **Spoofed / Impersonated Browser User-Agent**.
   - Cloudflare classifies this as hostile bot activity and immediately triggers rate-limiting rules (Error 1015) or blocks.

2. **Shared Datacenter Egress (CDG Paris)**:
   - When you visit `https://rsma.euno.cc` from France, Cloudflare routes your request to its Paris datacenter (**CDG**).
   - The Worker executes in CDG and makes outbound subrequests to `https://apis.roblox.com/oauth/v1/token` from CDG's shared outbound IP addresses.
   - Once the CDG egress IP pool or the specific pattern was flagged by Roblox's Cloudflare rate limit rule, every subsequent OAuth attempt from Paris returned `429 error code: 1015\n`.

3. **Why did `doozerdozy` succeed at 04:07 UTC on the same code?**:
   - The user `doozerdozy` (`474692821`) connected from outside France.
   - Their request was executed in a different Cloudflare datacenter (e.g. US or UK), which egressed through a different IP pool that had not been rate-limited by Roblox.

4. **Why direct `curl` from your PC worked**:
   - When running `curl` directly from your home/office broadband (`46.193.57.8`), the request went directly to Roblox's gateway (`128.116.31.3`).
   - Your broadband IP is not rate limited, which proved that the block was isolated to the datacenter egress.

---

## 5. Required Actions

### Action 1: Remove Fake `USER_AGENT` from `worker/auth/index.ts`
Completely remove the hardcoded `USER_AGENT` variable and revert the request headers to standard HTTP API headers:
```ts
// Token exchange
const tokenRes = await fetch(`${base(c.env)}/oauth/v1/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ ... }),
});

// Profile fetch
const infoRes = await fetch(`${base(c.env)}/oauth/v1/userinfo`, {
  headers: { Authorization: `Bearer ${access_token}` },
});
```

### Action 2: Prevent Admin Lockout During Rate Limits
In `worker/auth/index.ts`, when checking `getMe()` for users logging in via access token:
If `claims.via === "token"` and the user ID matches `c.env.INITIAL_ADMIN_ROBLOX_ID` (`242304445`), preserve their admin roles rather than stripping them to `[]`. This ensures you can never be locked out of your own site if an upstream OAuth provider has temporary network issues.
