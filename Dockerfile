# ---- Stage 1: Install dependencies ----
FROM oven/bun:1-alpine AS deps

WORKDIR /app

# Copy package files first for layer caching
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile || bun install

# ---- Stage 2: Build ----
FROM oven/bun:1-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json bun.lock* ./
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV DOCKER_BUILD=true

RUN bun run build

# ---- Stage 3: Runtime ----
FROM oven/bun:1-alpine AS runner

RUN apk add --no-cache ca-certificates \
    && rm -rf /var/cache/apk/* \
    && rm -rf /tmp/*

RUN addgroup -g 1001 -S appgroup && adduser -u 1001 -S appuser -G appgroup

WORKDIR /app

RUN mkdir -p /app/video-cache /app/data && chown -R appuser:appgroup /app/video-cache /app/data

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3333
ENV DOCKER_BUILD=true

COPY --from=builder --chown=appuser:appgroup /app/.next/standalone ./
COPY --from=builder --chown=appuser:appgroup /app/scripts ./scripts
COPY --from=builder --chown=appuser:appgroup /app/start.js ./start.js
COPY --from=builder --chown=appuser:appgroup /app/public ./public
COPY --from=builder --chown=appuser:appgroup /app/.next/static ./.next/static

USER appuser

EXPOSE 3333

CMD ["bun", "start.js"]
