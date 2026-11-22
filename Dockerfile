# Multi-stage production Dockerfile for OURO SaaS Platform (Cloud Run / Container Apps)
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG VITE_APP_ENV=production
ENV VITE_APP_ENV=${VITE_APP_ENV}
RUN npm run lint && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Create non-root runtime user and private storage mount directory
RUN addgroup -S ouro && adduser -S ouro -G ouro \
  && mkdir -p /app/storage/private \
  && chown -R ouro:ouro /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder --chown=ouro:ouro /app/dist ./dist
COPY --from=builder --chown=ouro:ouro /app/server.ts ./server.ts
COPY --from=builder --chown=ouro:ouro /app/src ./src
COPY --from=builder --chown=ouro:ouro /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=ouro:ouro /app/firebase-applet-config.json* ./

# Install tsx runtime to execute TypeScript server entrypoint cleanly
RUN npm install --no-save tsx

USER ouro
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/ready || exit 1

CMD ["npx", "tsx", "server.ts"]
