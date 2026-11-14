# DnsConf UI

Browser-based onboarding UI for [noVibe/DnsConf](https://github.com/noVibe/DnsConf).  
Configure DNS blocklists and redirects for Cloudflare / NextDNS — without touching YAML or leaving the browser.

## What it does

1. **Authenticate** via GitHub Device Flow — no password, no token storage
2. **Configure** DNS provider credentials, DNS donors, and source URLs (BLOCK / REDIRECT lists)
3. **Provision** — forks the DnsConf repo, uploads encrypted secrets to GitHub Actions,
   creates workflow variables, and dispatches the first run

All GitHub API calls are made directly from the browser using your ephemeral OAuth token.
Provider credentials pass through this app's own API routes only to be checked with Cloudflare / NextDNS
(and, in quick mode, to configure the NextDNS profile). The app has no database and never stores them.

## Why is it secure

| Concern | How it's handled |
|---|---|
| GitHub token | Exists only in browser memory — destroyed on tab close or refresh |
| Provider secrets (`AUTH_SECRET`, `CLIENT_ID`) | Encrypted in the browser with libsodium before they are sent to GitHub Actions Secrets. The credential check and quick-mode NextDNS setup send them through this app's server to the provider, which is the only place they go |
| Credential storage | The app stores nothing — no database, no sessions, no cookies |
| XSS | CSP headers without JavaScript `eval` in production (only WebAssembly is allowed, for libsodium), no third-party scripts, a single static inline script that applies the theme |
| API routes | Device Flow code/token exchange, credential checks, NextDNS setup and DNS donor checks use same-origin Next.js route handlers — no CORS exposure |

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

Quick mode enables GeoHide RU by default and also offers GeoHide EU/US, Comss, MagicDNS, Bezmezhau,
WLRUS, Malw, Dagami and DNS-AI presets. Expert mode accepts
an IPv4 address or a DNS-over-HTTPS URL. Donors are stored in the `DONOR_DNS` GitHub Actions variable
in profile order; disabled profiles use `-` to preserve positional mapping.

## Quick start

### Run with Docker — recommended

Only Docker is needed, no Node.js and no npm.
Install [Docker Desktop](https://www.docker.com/products/docker-desktop/), then:

- **Windows:** double-click `docker-start.cmd`
- **macOS / Linux:** run `./docker-start.sh`

The script creates `.env`, builds the image and starts the app at
http://localhost:3000. There is nothing to fill in.

Prefer doing it by hand?

```bash
docker compose up --build
```

Then open http://localhost:3000.

```bash
docker compose logs -f   # logs
docker compose down      # stop
```

### Optional — use your own GitHub OAuth App

Out of the box the app signs you in through the project's own OAuth App, so no
GitHub setup is needed. The trade-off is that GitHub's authorization screen shows
the project owner's name, and GitHub's limit of 50 verification-code submissions
per hour is shared by everyone using that app.

To use an app of your own instead:

1. Create a GitHub OAuth App at https://github.com/settings/developers
2. Enable **Device Flow** for the app
3. Paste its **Client ID** into the field on the app's own start screen, under
   *"Signing in with the project's shared key"*

That takes effect immediately and is remembered in your browser: no rebuild, no
restart, no environment variable. The Client ID is not a secret — it is part of
every authorization request and is visible in the browser by design — and this
app never uses a client secret.

The same ID can be compiled into the image instead, for a deployment that should
come up already configured:

```bash
cp .env.example .env     # on Windows: copy .env.example .env
# Set NEXT_PUBLIC_GITHUB_CLIENT_ID in .env
docker compose up --build -d
```

That way needs the rebuild: Next.js compiles the value into the browser bundle,
so `--build` is what picks up a change.

**[DOCKER.md](DOCKER.md) has the full step-by-step guide and troubleshooting
(also in Russian / на русском).**

### Run with Node.js — for development

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

To authorize through your own OAuth App, copy `.env.example` to `.env.local`
and set `NEXT_PUBLIC_GITHUB_CLIENT_ID` there.

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
