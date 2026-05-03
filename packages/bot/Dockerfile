FROM node:20-alpine AS base
RUN npm install -g pnpm

WORKDIR /app
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/bot/package.json ./packages/bot/
RUN pnpm install --frozen-lockfile

COPY packages/db ./packages/db
COPY packages/bot ./packages/bot
COPY tsconfig.base.json ./

WORKDIR /app/packages/bot
RUN pnpm build

CMD ["node", "dist/index.js"]
