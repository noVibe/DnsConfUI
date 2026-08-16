# DnsConf UI

Browser-based onboarding UI for [noVibe/DnsConf](https://github.com/noVibe/DnsConf).  
Configure DNS blocklists and redirects for Cloudflare / NextDNS — without touching YAML or leaving the browser.

## What it does

1. **Authenticate** via GitHub Device Flow — no password, no token storage
2. **Configure** DNS provider credentials, DNS donors, and source URLs (BLOCK / REDIRECT lists)
3. **Provision** — forks the DnsConf repo, uploads encrypted secrets to GitHub Actions,
   creates workflow variables, and dispatches the first run

All GitHub API calls are made directly from the browser using your ephemeral OAuth token.
The application has no backend, no database, and never sees your provider secrets.

## Why is it secure

| Concern | How it's handled |
|---|---|
| GitHub token | Exists only in browser memory — destroyed on tab close or refresh |
| Provider secrets (`AUTH_SECRET`, `CLIENT_ID`) | Encrypted in the browser with libsodium before reaching the network |
| Credential storage | The app stores nothing — no database, no sessions, no cookies |
| XSS | Strict CSP headers, no `dangerouslySetInnerHTML`, minimal third-party scripts |
| API routes | Device Flow code/token exchange uses same-origin Next.js route handlers — no CORS exposure |

## Multi-profile support

Configure several DNS profiles in one go. Each profile has its own CLIENT_ID, AUTH_SECRET,
DNS provider, and optional DNS donor — useful when managing multiple Cloudflare / NextDNS accounts.

## Updating an existing setup

After GitHub authorization, the UI checks whether the user already has a DnsConf fork. Existing
repository variables are loaded to restore profile order, DNS providers, donors, and source lists.
The user can either configure everything again or keep the existing `CLIENT_ID` and `AUTH_SECRET`
values in GitHub Actions Secrets.

When saved credentials are retained, the UI never reads or rewrites those secrets. Profile cards
show only their position and DNS provider, while donor and repository-variable settings remain
editable. Quick-mode NextDNS settings that require direct API access are disabled until the user
chooses a full reconfiguration and provides the credentials again.

## DNS donor

Quick mode enables GeoHide by default and also offers Xbox and Comss presets. Expert mode accepts
an IPv4 address or a DNS-over-HTTPS URL. Donors are stored in the `DONOR_DNS` GitHub Actions variable
in profile order; disabled profiles use `-` to preserve positional mapping.

## Quick start

```bash
npm install
cp .env.example .env.local
# Set NEXT_PUBLIC_GITHUB_CLIENT_ID in .env.local
npm run dev
```

### One-time setup

1. Create a GitHub OAuth App at https://github.com/settings/developers
2. Enable **Device Flow** for the app
3. Copy the **Client ID** to `NEXT_PUBLIC_GITHUB_CLIENT_ID` in `.env.local`

## Tests

```bash
npm test          # run once
npm run test:watch  # watch mode
```

## Tech stack

- [Next.js](https://nextjs.org/) (App Router) — framework
- [React](https://react.dev/) — UI
- [Tailwind CSS](https://tailwindcss.com/) — styling
- [react-hook-form](https://react-hook-form.com/) + [Zod](https://zod.dev/) — forms and validation
- [Octokit](https://github.com/octokit) — GitHub API client
- [libsodium-wrappers](https://github.com/jedisct1/libsodium.js) — browser-side encryption
- [Vitest](https://vitest.dev/) — testing
