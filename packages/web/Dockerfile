FROM node:20-alpine AS base
RUN npm install -g pnpm

WORKDIR /app
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/web/package.json ./packages/web/
RUN pnpm install --frozen-lockfile

COPY packages/db ./packages/db
COPY packages/web ./packages/web
COPY tsconfig.base.json ./

WORKDIR /app/packages/web
RUN pnpm build

CMD ["node", "./dist/server/entry.mjs"]
