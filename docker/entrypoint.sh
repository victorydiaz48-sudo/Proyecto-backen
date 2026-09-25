#!/bin/sh
# Comandos de la imagen:
#   serve                      servidor (por defecto)
#   migrate                    prepara el usuario reservas_app y aplica las migraciones (pre-deploy);
#                              necesita MIGRATION_DATABASE_URL (propietario) y DATABASE_URL (reservas_app)
#   tenant-create …            alta de un negocio (mismos argumentos que npm run tenant:create)
#   import-generator …         importador del JSON del generador
set -e
cd /app/apps/api
cmd="${1:-serve}"
[ $# -gt 0 ] && shift
case "$cmd" in
  serve) exec node dist/server.js ;;
  migrate)
    if [ -z "$MIGRATION_DATABASE_URL" ]; then
      echo "Falta MIGRATION_DATABASE_URL (propietario del esquema)." >&2
      exit 1
    fi
    node dist/cli/prepare-database.js
    exec /app/node_modules/.bin/prisma migrate deploy ;;
  tenant-create) exec node dist/cli/tenant-create.js "$@" ;;
  import-generator) exec node dist/cli/import-generator.js "$@" ;;
  *) exec "$cmd" "$@" ;;
esac
