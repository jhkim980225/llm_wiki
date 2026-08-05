# syntax=docker/dockerfile:1

# ── 의존성 ────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── 빌드 ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma 클라이언트는 빌드 전에 있어야 한다.
RUN npx prisma generate
# 빌드 시점에는 DB가 없다. 실제 값은 런타임 env로 들어온다.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── 실행 ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 런타임에 필요한 것은 query engine(.prisma)과 클라이언트뿐이다.
# prisma CLI(70MB)와 @prisma/engines(schema-engine, ~100MB)는 싣지 않는다 —
# 마이그레이션은 전용 이미지(Dockerfile.migrate)가 돈다.
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
