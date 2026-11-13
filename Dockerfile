# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# DnsConf UI — production image
#
# Build and run everything with one command:
#   docker compose up --build
#
# See DOCKER.md for the step-by-step guide.
# ---------------------------------------------------------------------------


# --- Stage 1: install dependencies -----------------------------------------
FROM node:22-alpine AS deps

WORKDIR /app

# Only the manifests are copied here, so this layer is reused as long as
# package.json / package-lock.json stay unchanged.
COPY package.json package-lock.json ./
RUN npm ci


# --- Stage 2: build the app ------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# The GitHub OAuth Client ID is a public value (it ends up in the browser
# bundle), and Next.js inlines NEXT_PUBLIC_* variables at build time — so it
# has to be available while building, not only at runtime.
ARG NEXT_PUBLIC_GITHUB_CLIENT_ID=""
ENV NEXT_PUBLIC_GITHUB_CLIENT_ID=$NEXT_PUBLIC_GITHUB_CLIENT_ID

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The project has no public/ directory today; creating it keeps the COPY in
# the runtime stage working either way.
RUN mkdir -p public && npm run build


# --- Stage 3: runtime ------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Listen on every interface so the port published by Docker actually answers.
ENV HOSTNAME=0.0.0.0

# Run as an unprivileged user instead of root.
RUN addgroup -g 1001 -S nodejs \
 && adduser -S -D -u 1001 -G nodejs nextjs

# Owned by the app user so Next.js can create its runtime cache under .next/
# if a page ever starts using revalidation.
RUN mkdir -p .next && chown nextjs:nodejs .next

# `output: "standalone"` bundles the server together with just the node_modules
# it really needs, which keeps this image small.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:${PORT}/" || exit 1

CMD ["node", "server.js"]
