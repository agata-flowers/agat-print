FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/printer-agent/package.json apps/printer-agent/package.json
RUN pnpm install --frozen-lockfile --filter @agat/printer-agent...
COPY apps/printer-agent apps/printer-agent
RUN pnpm --filter @agat/printer-agent build

FROM node:24-alpine
ENV NODE_ENV=production
USER node
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/printer-agent/dist ./dist
ENTRYPOINT ["node", "dist/index.js"]
