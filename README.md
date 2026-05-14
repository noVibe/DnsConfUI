# DnsConf UI

Frontend-only onboarding UI for [noVibe/DnsConf](https://github.com/noVibe/DnsConf).

## MVP scope

- GitHub Device Flow authentication
- DnsConf environment setup screen
- user fork provisioning
- GitHub Actions secrets upload with browser-side encryption
- GitHub Actions variables creation/update
- initial `github_action.yml` dispatch

Device Flow starts through same-origin Next.js route handlers because GitHub OAuth endpoints are
not reliable browser CORS targets. The route handlers do not store tokens or provider secrets.

## Local setup

End users do not create GitHub OAuth Apps. This is a one-time setup for the person deploying or
running this configurator.

1. Create one GitHub OAuth App for this configurator and enable Device Flow.
2. Copy `.env.example` to `.env.local`.
3. Set `NEXT_PUBLIC_GITHUB_CLIENT_ID`.
4. Install dependencies and run the app:

```bash
npm install
npm run dev
```

## Tests

```bash
npm test
```

The domain and provisioning tests cover the current upstream DnsConf workflow mapping:

- `CLIENT_ID` -> GitHub Actions secret
- `AUTH_SECRET` -> GitHub Actions secret
- `DNS` -> GitHub Actions variable
- `BLOCK` -> GitHub Actions variable
- `REDIRECT` -> GitHub Actions variable

`EXCLUDE_REDIRECT` is sent to GitHub as a workflow variable and is consumed by the upstream
DnsConf workflow.
