# syntax=docker/dockerfile:1
# Dos imágenes desde el mismo Dockerfile (ver docs/DEPLOYMENT.md):
#   docker build --target runtime -t reservas .          # servidor: API /api/* + panel (SPA), mismo origen
#   docker build --target migrate -t reservas-migrate .  # migraciones (herramienta de Prisma), por release
#   docker run --rm -e MIGRATION_DATABASE_URL=… reservas-migrate
#   docker run -e DATABASE_URL=… -p 3000:3000 reservas
# El servidor no lleva la herramienta de línea de comandos de Prisma (incluye Prisma Studio, una BD
# embebida, React…): menos peso y menos superficie de ataque.

ARG NODE_IMAGE=node:22-bookworm-slim
ARG MIGRATE_IMAGE=node:22-bookworm

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

# ---- migrate: aplica las migraciones con el propietario del esquema (MIGRATION_DATABASE_URL) ----
# Imagen completa (no slim): el motor de migraciones de Prisma necesita OpenSSL. Solo se usa al desplegar.
FROM ${MIGRATE_IMAGE} AS migrate
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
RUN npm ci --workspace apps/api --include-workspace-root=false --no-audit --no-fund \
    && npm cache clean --force
COPY apps/api/prisma/schema.prisma apps/api/prisma/schema.prisma
COPY apps/api/prisma/migrations apps/api/prisma/migrations
COPY apps/api/prisma.config.ts apps/api/prisma.config.ts
USER node
WORKDIR /app/apps/api
ENTRYPOINT ["/app/node_modules/.bin/prisma"]
CMD ["migrate", "deploy"]

# ---- runtime: solo dependencias de producción de la API ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY docker/prune-optional-peers.mjs /tmp/
# Solo dependencias de producción de la API. npm instala también las peers opcionales (la herramienta
# de Prisma y lo que arrastra); se quitan en el mismo paso para que no ocupen espacio en la imagen.
RUN npm ci --omit=dev --workspace apps/api --include-workspace-root=false --no-audit --no-fund \
    && node /tmp/prune-optional-peers.mjs /app apps/api \
    && rm /tmp/prune-optional-peers.mjs \
    && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/admin/dist apps/admin/dist
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/entrypoint

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["entrypoint"]
CMD ["serve"]
