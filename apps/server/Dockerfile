# Build context: repository root (Railway/Render use the repo root by default).
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile --filter @autocontent/server...
RUN pnpm --filter @autocontent/server build

FROM node:22-slim
ENV NODE_ENV=production \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /app
# OpenSSL: required by Prisma's migration engine (slim images don't ship it).
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Prisma CLI is only needed to run `migrate deploy` at startup. Pinned to the
# version the schema was built with.
RUN npm install -g prisma@7.10.0 --no-audit --no-fund && npm cache clean --force
# The app itself is one self-contained file.
COPY --from=build /app/apps/server/dist ./dist
COPY packages/database/prisma ./prisma
COPY apps/server/docker/prisma.config.mjs apps/server/docker/start.sh ./
RUN mkdir -p /tmp/autocontent-storage && chown node:node /tmp/autocontent-storage
USER node
EXPOSE 3000
CMD ["sh", "./start.sh"]
