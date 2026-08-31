# syntax=docker/dockerfile:1

# ── Build stage ────────────────────────────────────────────────────────────
# Installs full (dev + prod) dependencies and compiles TypeScript to dist/,
# matching the local `npm run build` script (tsc --project tsconfig.json).
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ── Runtime stage ───────────────────────────────────────────────────────────
# Only production dependencies + the compiled dist/ output ship in the final
# image — no TypeScript, ESLint, Vitest, or source files.
FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Matches backend/.env.example's PORT default (3000). The actual listening
# port still comes from the PORT env var at runtime (src/config/env.ts) —
# this only documents/exposes the default for container tooling.
EXPOSE 3000

# Runs unprivileged — node:20-alpine ships a built-in, non-root "node" user.
USER node

CMD ["node", "dist/index.js"]
