# GRKD-Jisho Bot — multi-stage Dockerfile
# Builds @grkd-jisho/db then @grkd-jisho/bot in a single builder stage.
# Runtime stage copies the full builder output (node_modules + dist).

FROM node:20-alpine AS builder
RUN npm install -g pnpm@10
WORKDIR /app

# Dependency manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/db/package.json packages/db/tsconfig.json ./packages/db/
COPY packages/bot/package.json packages/bot/tsconfig.json ./packages/bot/

# Install all deps (devDependencies included for build)
RUN pnpm install --frozen-lockfile

# Build db first (bot depends on db/dist)
COPY packages/db/src ./packages/db/src
RUN pnpm --filter @grkd-jisho/db run build

# Build bot
COPY packages/bot/src ./packages/bot/src
RUN pnpm --filter @grkd-jisho/bot run build

# ---- Runtime ----
FROM node:20-alpine
RUN npm install -g pnpm@10
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app

# Copy entire builder output (node_modules + dist + manifests)
COPY --from=builder /app ./

USER appuser
CMD ["node", "packages/bot/dist/index.js"]
