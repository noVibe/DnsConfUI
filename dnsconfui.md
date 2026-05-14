# DnsConf Web Configurator - Technical Specification

## 1. Project Goal

Create a frontend-only web application that simplifies onboarding and configuration for the existing GitHub-based project:

- https://github.com/noVibe/DnsConf

The application should remove the need for users to:

- manually fork repositories
- configure GitHub Actions
- create GitHub Secrets manually
- edit workflow variables manually
- understand GitHub Actions YAML

The system is NOT a DNS SaaS platform.

The system is a:

> GitHub automation configurator and onboarding UI for DnsConf.

Execution, scheduling, secret storage, and automation remain delegated to GitHub Actions.

---

# 2. High-Level Architecture

## Architecture Style

Frontend-only application.

No custom backend.

No custom database.

No worker infrastructure.

No scheduler infrastructure.

## Final Architecture

```text
Next.js frontend (Vercel)
        |
GitHub OAuth
        |
GitHub REST API
        |
User fork of DnsConf
        |
GitHub Actions execution
```

---

# 3. Core Product Flow

## User Flow

1. User opens website
2. User authenticates with GitHub OAuth
3. User fills configuration form
4. Frontend:
   - forks DnsConf repository
   - creates GitHub Actions secrets
   - creates GitHub Actions variables
   - optionally updates workflow files/config files
   - enables GitHub Actions
   - triggers initial workflow run
5. User leaves website
6. GitHub Actions performs recurring scheduled updates automatically

The website itself performs no recurring background work.

---

# 4. Hosting

## Frontend Hosting

Use:

- Vercel

Reasoning:

- free tier sufficient
- excellent Next.js integration
- static-first architecture
- minimal operational overhead
- no backend infrastructure required

---

# 5. Frontend Stack

## Framework

- Next.js (latest stable)
- TypeScript

## UI

- React
- shadcn/ui
- Tailwind CSS

## Forms

- React Hook Form
- Zod validation

## GitHub API

- Octokit

## Crypto

- libsodium-wrappers

Reason:

GitHub Actions Secrets API requires client-side encryption using repository public keys.

---

# 6. Security Model

## Important Principle

The application MUST NOT store user credentials.

This includes:

- GitHub access tokens
- Cloudflare API tokens
- NextDNS credentials
- Any provider secrets

---

## Token Lifetime

GitHub OAuth token exists only in browser memory.

DO NOT:

- store in localStorage
- store in sessionStorage
- store in IndexedDB
- persist in cookies
- persist server-side

After page refresh or tab close, re-authentication is acceptable.

---

## Secret Handling

Provider secrets are:

1. entered by user
2. encrypted in browser
3. uploaded directly to GitHub Secrets API
4. discarded from memory

The application server MUST NEVER see provider secrets.

---

## XSS Mitigation Requirements

Because browser-side crypto is used, XSS prevention is critical.

Mandatory:

- strict CSP headers
- no dangerous HTML injection
- no use of dangerouslySetInnerHTML
- minimal third-party scripts
- no unnecessary analytics scripts initially
- dependency review for crypto-related libraries

---

# 7. OAuth Strategy

## Authentication Method

Use GitHub OAuth App.

NOT GitHub App initially.

Reasoning:

- simpler frontend-only architecture
- easier token handling
- simpler integration flow
- faster MVP delivery

---

## Required GitHub Scopes

Initial scopes:

```text
repo
workflow
read:user
```

Additional scopes only if required.

Principle:

- least privilege possible

---

# 8. GitHub Operations

## Required GitHub API Operations

### Repository Fork

```http
POST /repos/{owner}/{repo}/forks
```

---

## Retrieve Repository Public Key

```http
GET /repos/{owner}/{repo}/actions/secrets/public-key
```

---

## Upload GitHub Actions Secret

```http
PUT /repos/{owner}/{repo}/actions/secrets/{name}
```

Secrets must be encrypted client-side.

---

## Create GitHub Actions Variables

```http
POST /repos/{owner}/{repo}/actions/variables
```

or equivalent update endpoints.

---

## Trigger Workflow

```http
POST /repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches
```

---

# 9. Configuration Mapping

## DnsConf Existing Variables

The configurator UI should map directly to the existing DnsConf environment variables.

Known variables include:

| Variable | Type | Description |
|---|---|---|
| AUTH_SECRET | secret | Provider API secret |
| CLIENT_ID | secret | Provider client/account identifier |
| DNS | variable | DNS provider selection |
| BLOCK | variable | Blocklist URLs |
| REDIRECT | variable | Redirect source URLs |
| EXCLUDE_REDIRECT | variable | Redirect exclusions |

Additional variables should remain extensible.

---

# 10. Frontend Pages

## Landing Page

Purpose:

- explain product
- explain GitHub-based architecture
- explain required permissions
- explain no credential storage policy

CTA:

- Connect GitHub

---

## Dashboard Page

Minimal functionality:

- show connected repository
- show configuration status
- show last workflow status
- allow reconfiguration
- allow retriggering workflow

No complex analytics required.

---

## Setup Wizard

Multi-step form:

### Step 1

Select provider:

- Cloudflare
- NextDNS
- future providers

---

### Step 2

Enter credentials.

---

### Step 3

Enter source list URLs.

---

### Step 4

Configure redirects/exclusions.

---

### Step 5

Review summary.

---

### Step 6

Provision GitHub repository automatically.

---

# 11. Repository Strategy

## Recommended Approach

Each user receives:

- their own fork of DnsConf

Reasoning:

- GitHub Actions ownership stays with user
- GitHub Secrets stay in user repository
- compute cost delegated to GitHub
- execution isolation solved automatically
- no multi-tenant execution environment required

---

# 12. Workflow Strategy

## Existing Workflow Reuse

Reuse existing DnsConf GitHub Actions workflow whenever possible.

Avoid modifying workflow architecture initially.

The configurator should adapt itself to the existing workflow model.

---

# 13. Persistence Strategy

## Initial MVP

No application database.

All persistent state lives in:

- GitHub repository
- GitHub Actions secrets
- GitHub Actions variables

The frontend application itself remains stateless.

---

# 14. Operational Cost Model

## Expected Cost

| Component | Provider | Expected Cost |
|---|---|---|
| Frontend Hosting | Vercel | Free |
| Execution | GitHub Actions | Mostly Free |
| Secret Storage | GitHub Secrets | Free |
| Scheduling | GitHub Actions Cron | Free |

---

# 15. Non-Goals

The MVP MUST NOT include:

- custom backend scheduler
- PostgreSQL database
- worker queues
- Redis
- Kubernetes
- multi-tenant execution engine
- hosted DNS processing infrastructure
- billing system
- realtime features
- collaborative editing
- self-hosted execution environment

---

# 16. Scalability Philosophy

The architecture intentionally delegates:

- execution
- scheduling
- secret storage
- automation
- compute

To GitHub.

The product value is:

> UX abstraction over GitHub Actions onboarding.

NOT infrastructure hosting.

---

# 17. Future Extensions (Out of Scope for MVP)

Potential future features:

- GitHub App migration
- provider presets
- source list marketplace
- import/export profiles
- configuration templates
- self-hosted mode
- optional hosted execution backend
- provider health monitoring
- workflow failure notifications
- multi-provider orchestration

These are explicitly NOT required for MVP.

---

# 18. Recommended Initial Deliverables

## Phase 1

- GitHub OAuth
- basic landing page
- setup wizard
- repository fork automation
- GitHub Secrets creation
- GitHub Variables creation
- workflow dispatch

---

## Phase 2

- dashboard
- workflow status display
- edit existing configuration
- reconnect/reconfigure flows

---

## Phase 3

- UX polish
- templates
- presets
- validation improvements

---

# 19. Engineering Principles

## Priorities

1. Simplicity
2. Zero operational overhead
3. Minimal credential exposure
4. Fast onboarding
5. Minimal maintenance burden
6. GitHub-native workflow compatibility

---

# 20. Final Architectural Decision

The final approved architecture is:

```text
Frontend-only Next.js application hosted on Vercel.

The application authenticates users with GitHub OAuth,
configures GitHub repositories and GitHub Actions directly from the browser,
and delegates all execution/scheduling/secret storage responsibilities to GitHub.
```

No custom backend infrastructure is included in MVP.
