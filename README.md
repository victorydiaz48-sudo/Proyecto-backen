# Proyecto-backen

Plataforma de reservas multi-tenant (empezando por barberías) y el generador de páginas de contacto.

- `generador-pagina-contacto.html` — generador de páginas estáticas (reserva por WhatsApp). No se
  modifica hasta la Fase 13 del plan.
- `apps/api` — backend (Node.js + TypeScript + Fastify + Prisma + PostgreSQL).
- `docs/` — plan, arquitectura, base de datos, API, seguridad, testing e integración.
  Empieza por [docs/BACKEND_PLAN.md](docs/BACKEND_PLAN.md).

## Desarrollo

Requisitos: Node.js ≥ 22.12 y PostgreSQL 16 (o Docker).

```bash
npm install
npm run db:up                                   # PostgreSQL en Docker (opcional si ya tienes uno)
cp apps/api/.env.example apps/api/.env          # ajusta las URLs si hace falta
npm run db:migrate                              # aplica las migraciones a la BD de desarrollo
npm run db:seed                                 # barberia-a y barberia-b de ejemplo

npm run typecheck && npm run lint && npm test   # lo mismo que ejecuta CI
npm run db:check-drift                          # schema.prisma coincide con las migraciones
```
