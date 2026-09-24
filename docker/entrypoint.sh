#!/bin/sh
# Comandos de la imagen del servidor:
#   serve                      servidor (por defecto)
#   tenant-create …            alta de un negocio (mismos argumentos que npm run tenant:create)
#   import-generator …         importador del JSON del generador
set -e
cd /app/apps/api
cmd="${1:-serve}"
[ $# -gt 0 ] && shift
case "$cmd" in
  serve) exec node dist/server.js ;;
  migrate)
    echo "Las migraciones se aplican con la imagen de migraciones (docker build --target migrate)." >&2
    exit 1 ;;
  tenant-create) exec node dist/cli/tenant-create.js "$@" ;;
  import-generator) exec node dist/cli/import-generator.js "$@" ;;
  *) exec "$cmd" "$@" ;;
esac
