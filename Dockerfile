# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl

# ── Dependencies ──────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate

# ── Build ─────────────────────────────────────────────────
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

# ── Production ────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

RUN apk add --no-cache wget \
  && addgroup --system --gid 1001 aparis \
  && adduser --system --uid 1001 aparis

COPY --from=build --chown=aparis:aparis /app/node_modules ./node_modules
COPY --from=build --chown=aparis:aparis /app/dist ./dist
COPY --from=build --chown=aparis:aparis /app/package.json ./package.json
COPY --from=build --chown=aparis:aparis /app/prisma ./prisma

USER aparis
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health || exit 1

# Apply Prisma migrations against DATABASE_URL, then start the API on 0.0.0.0:3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
