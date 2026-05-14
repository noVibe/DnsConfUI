# DnsConf UI

Browser-based onboarding UI for [noVibe/DnsConf](https://github.com/noVibe/DnsConf).  
Configure DNS blocklists and redirects for Cloudflare / NextDNS — without touching YAML or leaving the browser.

## What it does

1. **Authenticate** via GitHub Device Flow — no password, no token storage
2. **Configure** DNS provider credentials and source URLs (BLOCK / REDIRECT lists)
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
and DNS provider — useful when managing multiple Cloudflare / NextDNS accounts.

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
