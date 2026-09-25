# syntax=docker/dockerfile:1
# Imagen de producción: la API sirve /api/* y el panel (SPA) en el mismo origen, y aplica las
# migraciones con el comando `migrate` (pensado para el pre-deploy de la plataforma). Ver docs/DEPLOYMENT.md.
#   docker build -t reservas .
#   docker run --rm -e MIGRATION_DATABASE_URL=… -e DATABASE_URL=… reservas migrate   # antes de cada versión
#   docker run -e DATABASE_URL=… -p 3000:3000 reservas                               # servidor

ARG NODE_IMAGE=node:22-bookworm-slim

# ---- build: dependencias completas, compila el panel y la API ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY apps/admin apps/admin
RUN npm run build

# ---- runtime: servidor + migraciones, solo dependencias de producción de la API ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
# El motor de migraciones de Prisma necesita OpenSSL (la imagen slim no lo trae).
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY docker/prune-optional-peers.mjs /tmp/
# Solo dependencias de producción de la API (incluida la herramienta de migraciones de Prisma). npm
# instala también peers opcionales que nada usa; se quitan en el mismo paso para no ocupar espacio.
RUN npm ci --omit=dev --workspace apps/api --include-workspace-root=false --no-audit --no-fund \
    && node /tmp/prune-optional-peers.mjs /app apps/api \
    && rm /tmp/prune-optional-peers.mjs \
    && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/admin/dist apps/admin/dist
COPY apps/api/prisma/schema.prisma apps/api/prisma/schema.prisma
COPY apps/api/prisma/migrations apps/api/prisma/migrations
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/entrypoint

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["entrypoint"]
CMD ["serve"]
