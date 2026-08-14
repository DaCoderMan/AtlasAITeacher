# ChatGPT remote MCP

Atlas supports local stdio MCP and remote HTTPS MCP over the same semantic tool surface.

## ChatGPT requirement

ChatGPT cannot connect directly to the local stdio server. Atlas now supports a standards-based OAuth resource-server path for public `/api/mcp` deployments, while Secure MCP Tunnel remains suitable for private/local deployments.

ChatGPT developer-mode apps support OAuth authentication. For durable connectivity, configure the authorization server to issue refresh tokens; OpenID Connect providers should advertise and honor `offline_access` where appropriate.

## Authentication modes

Atlas keeps three explicit boundaries:

1. **OAuth (recommended for public ChatGPT MCP):** configure `ATLAS_MCP_OAUTH_ISSUER`, `ATLAS_MCP_OAUTH_AUDIENCE`, and `ATLAS_MCP_OAUTH_JWKS_URL`. Atlas validates RS256 JWT access tokens for issuer, audience, signature, expiration and scopes.
2. **Legacy static bearer:** `ATLAS_MCP_SECRET` remains supported for direct HTTP clients and smoke tests. This is not the ChatGPT app OAuth flow.
3. **Tunnel-only unauthenticated mode:** `ATLAS_MCP_ALLOW_UNAUTHENTICATED=true` is permitted only behind Secure MCP Tunnel or another trusted private boundary. Never enable it on a public endpoint.

OAuth and the legacy static bearer path may coexist during migration.

## OAuth discovery

The public deployment exposes RFC 9728 Protected Resource Metadata at:

`/.well-known/oauth-protected-resource`

It advertises the MCP resource and `authorization_servers`. Unauthorized OAuth requests receive `401` with a `WWW-Authenticate: Bearer` challenge containing the `resource_metadata` URL.
If OAuth is not configured yet, Atlas still serves the metadata document but `authorization_servers` remains empty until an external provider is wired in.

The authorization server itself is external/provider-independent and must expose OAuth Authorization Server Metadata or compatible OIDC discovery. It must implement Authorization Code + PKCE for interactive ChatGPT authorization and support refresh tokens for durable access.

## Scopes

- `atlas.read` — MCP discovery and read operations.
- `atlas.write` — mutation operations. OAuth mutation calls require this scope.
- `offline_access` — request at the authorization server when its refresh-token model uses this OIDC scope.

Atlas validates that OAuth JWTs are issued for `ATLAS_MCP_OAUTH_AUDIENCE`; tokens for another resource are rejected.

## Environment variables

Required for OAuth mode:

- `ATLAS_MCP_OAUTH_ISSUER` — exact token issuer / authorization-server identifier.
- `ATLAS_MCP_OAUTH_AUDIENCE` — exact audience for Atlas MCP, normally the canonical `https://.../api/mcp` URL.
- `ATLAS_MCP_OAUTH_JWKS_URL` — HTTPS JWKS endpoint used to verify RS256 access-token signatures.

Optional:

- `ATLAS_MCP_OAUTH_AUTHORIZATION_SERVER` — override the authorization-server identifier advertised in protected-resource metadata when it differs from the token issuer URL. For Auth0, this normally matches the issuer/custom-domain base URL.
- `ATLAS_MCP_RESOURCE_URL` — override the canonical protected resource URL.
- `ATLAS_MCP_RESOURCE_METADATA_URL` — override the RFC 9728 metadata URL.
- `ATLAS_MCP_SECRET` — legacy bearer secret for compatible non-ChatGPT clients.
- `ATLAS_MCP_ALLOW_UNAUTHENTICATED=true` — tunnel/private-boundary use only.

Do not commit secrets or raw access/refresh tokens.

## ChatGPT setup

1. Deploy Atlas over HTTPS without removing or altering the existing `project-x-sync` scheduling behavior.
2. Configure the OAuth issuer/audience/JWKS environment variables.
3. Configure an OAuth/OIDC authorization server that supports Authorization Code + PKCE and refresh tokens.
4. Enable Developer Mode in ChatGPT.
5. Create the custom app with the stable Atlas `/api/mcp` endpoint and select OAuth authentication.
6. Complete authorization, scan tools, then test safe reads first.
7. Enable/test mutation tools only when the ChatGPT plan/workspace and Atlas scopes permit them.

Secure MCP Tunnel remains an alternative when Atlas runs locally or on a private network.

## Auth0 setup

Preferred path for Atlas remote MCP is Auth0 plus ChatGPT OAuth.

Auth0 tenant/API configuration:

1. Create or reuse an Auth0 API whose Identifier exactly matches the canonical Atlas MCP resource URL, for example `https://atlas.example.com/api/mcp`.
2. Leave the API signing algorithm as `RS256`.
3. Define API permissions `atlas.read` and `atlas.write`.
4. Enable offline access for that API so `offline_access` can return refresh tokens.
5. Use Auth0 OIDC discovery at `https://<tenant-or-custom-domain>/.well-known/openid-configuration`; Atlas should use the same base URL for `ATLAS_MCP_OAUTH_ISSUER`.
6. Use the discovery document’s `jwks_uri` for `ATLAS_MCP_OAUTH_JWKS_URL`.

Client-registration choices:

1. `DCR` is the lowest-friction Auth0 path for ChatGPT because Auth0 supports open Dynamic Client Registration at `/oidc/register` when enabled, and ChatGPT supports DCR for MCP OAuth clients.
2. `CIMD` is also supported by both ChatGPT and Auth0. Choose it when you want a stable externally hosted client identity instead of DCR-created `tpc_` clients.
3. Pre-registering a static Auth0 application is only needed if you intentionally avoid DCR/CIMD. If you do that, use the exact redirect URI shown in the ChatGPT app-management page; do not guess it.

ChatGPT callback / redirect URI:

- Official OpenAI docs specify the production redirect format as `https://chatgpt.com/connector/oauth/{callback_id}`.
- The exact callback URL is shown in the ChatGPT app-management page for the specific MCP app instance. Add that exact URL to Auth0 Allowed Callback URLs.

Recommended Auth0 settings for ChatGPT MCP:

- Authorization Code flow enabled
- PKCE with `S256`
- refresh tokens enabled
- `offline_access` allowed
- OIDC discovery enabled
- JWTs signed with `RS256`
- If using DCR, enable Dynamic Client Registration in the tenant and configure default permissions/client grants so DCR-created third-party clients can request `atlas.read` and `atlas.write`

Atlas environment mapping:

- `ATLAS_MCP_OAUTH_ISSUER=https://<tenant-or-custom-domain>/`
- `ATLAS_MCP_OAUTH_AUTHORIZATION_SERVER=https://<tenant-or-custom-domain>/` (optional if same as issuer)
- `ATLAS_MCP_OAUTH_AUDIENCE=https://<public-atlas-host>/api/mcp`
- `ATLAS_MCP_OAUTH_JWKS_URL=https://<tenant-or-custom-domain>/.well-known/jwks.json`
- `ATLAS_MCP_RESOURCE_URL=https://<public-atlas-host>/api/mcp`

## Security

- Access tokens are never accepted from the query string.
- OAuth JWTs are validated for issuer, audience, signature, expiry and scope.
- Unknown signing keys and unsupported JWT algorithms are rejected.
- `atlas.write` is distinct from `atlas.read`.
- Public unauthenticated MCP is not an allowed production default.
- The existing hourly `project-x-sync` cron must not be removed merely to deploy MCP.

## Validation

Run:

```bash
npm run ci
```

Then verify:

- `GET /.well-known/oauth-protected-resource`
- unauthenticated `POST /api/mcp` returns `503` when no auth mode is configured at all
- unauthenticated `POST /api/mcp` returns `401` plus `WWW-Authenticate`
- valid `atlas.read` token can initialize/list/read
- read-only token receives `403` for mutation tools
- valid `atlas.write` token can reach mutation dispatch
- legacy `ATLAS_MCP_SECRET` still works
- local `node mcp/server.js` behavior is unchanged
