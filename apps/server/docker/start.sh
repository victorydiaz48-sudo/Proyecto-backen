#!/bin/sh
# Container entrypoint: apply pending database migrations, then start the app.
# Migrations are idempotent and serialised by Prisma with a database lock.
set -e
if [ -n "$DATABASE_URL" ]; then
  echo '{"level":"info","msg":"applying database migrations"}'
  prisma migrate deploy --config prisma.config.mjs
fi
exec node --enable-source-maps --no-deprecation dist/main.mjs
