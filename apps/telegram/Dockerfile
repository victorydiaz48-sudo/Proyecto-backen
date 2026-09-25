# Build context: repository root (Railway/Render use the repo root by default).
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/telegram ./apps/telegram
RUN pnpm install --frozen-lockfile --filter @autocontent/telegram...
RUN pnpm --filter @autocontent/telegram build

# The build output is a single self-contained bundle: no node_modules needed.
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/apps/telegram/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "--enable-source-maps", "--no-deprecation", "dist/index.cjs"]
