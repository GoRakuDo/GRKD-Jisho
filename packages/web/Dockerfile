# GRKD-Jisho Web Admin UI — multi-stage Dockerfile
# Builds @grkd-jisho/db then @grkd-jisho/web in a single builder stage.
# Runtime stage copies the full builder output.

FROM node:20-alpine AS builder
RUN npm install -g pnpm@10
WORKDIR /app

# Dependency manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/db/package.json packages/db/tsconfig.json ./packages/db/
COPY packages/web/package.json packages/web/tsconfig.json ./packages/web/

# Install all deps (devDependencies included for build)
RUN pnpm install --frozen-lockfile

# Build db first (web depends on db/dist)
COPY packages/db/src ./packages/db/src
RUN pnpm --filter @grkd-jisho/db run build

# Build web (astro build)
COPY packages/web/astro.config.mjs ./packages/web/
COPY packages/web/src ./packages/web/src
RUN pnpm --filter @grkd-jisho/web run build

# ---- Runtime ----
FROM node:20-alpine
RUN npm install -g pnpm@10
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app

# Copy entire builder output
COPY --from=builder /app ./

USER appuser
CMD ["node", "packages/web/dist/server/entry.mjs"]
