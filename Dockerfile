# Multi-stage production Dockerfile for OURO SaaS Platform (Bun + committed bun.lock)
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG VITE_APP_ENV=production
ENV VITE_APP_ENV=${VITE_APP_ENV}
RUN bun run lint && bun run build

FROM oven/bun:1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Create non-root runtime user and private storage mount directory
RUN addgroup -S ouro && adduser -S ouro -G ouro \
  && mkdir -p /app/storage/private \
  && chown -R ouro:ouro /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=builder --chown=ouro:ouro /app/dist ./dist
COPY --from=builder --chown=ouro:ouro /app/server.ts ./server.ts
COPY --from=builder --chown=ouro:ouro /app/src ./src
COPY --from=builder --chown=ouro:ouro /app/drizzle ./drizzle
COPY --from=builder --chown=ouro:ouro /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=ouro:ouro /app/firebase-applet-config.json* ./

USER ouro
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/ready || exit 1

CMD ["bun", "server.ts"]
