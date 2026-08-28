FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json eslint.config.mjs ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/providers/package.json packages/providers/package.json
RUN pnpm install --frozen-lockfile
COPY apps/api apps/api
COPY packages packages
RUN pnpm --filter @agat/api db:generate && pnpm --filter @agat/api build

FROM node:24-alpine
RUN corepack enable && apk add --no-cache docker-cli coreutils
WORKDIR /app
COPY --from=build /app /app
COPY ops/processing /app/ops/processing
CMD ["node", "apps/api/dist/cli/processing-worker.js"]
