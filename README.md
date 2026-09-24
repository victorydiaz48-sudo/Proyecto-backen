# Proyecto-backen

Plataforma de reservas multi-tenant (empezando por barberías) y el generador de páginas de contacto.

- `generador-pagina-contacto.html` — generador de páginas estáticas. Sin configurar nada, la reserva
  es por WhatsApp como siempre; con "Reservas en línea" (dirección del sistema + identificador del
  negocio) la página muestra horas reales y crea la cita en el backend. Ver
  [docs/FRONTEND_INTEGRATION.md](docs/FRONTEND_INTEGRATION.md).
- `apps/api` — backend (Node.js + TypeScript + Fastify + Prisma + PostgreSQL).
- `apps/admin` — panel de administración y de profesional (React + Vite), servido por la API.
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
npm run dev:api                                 # API en http://localhost:3000
npm run dev:admin                               # panel con recarga en caliente en http://localhost:5173
npm run build                                   # compila el panel; la API lo sirve en http://localhost:3000/

npm run typecheck && npm run lint && npm test   # lo mismo que ejecuta CI
npm run db:check-drift                          # schema.prisma coincide con las migraciones
```

Usuarios del seed: `admin@barberia-a.test` (ADMIN) y `carlos@barberia-a.test` (PROFESSIONAL), igual
para `barberia-b`; contraseña `dev-password-123`. Solo para desarrollo.

Alta de un negocio real (operador de la plataforma): `npm run tenant:create -w apps/api -- …`,
ver el ejemplo completo en [docs/API.md](docs/API.md) §3.

Importar un negocio desde el JSON que exporta el generador:
`npm run import:generator -w apps/api -- --file datos.json --slug mi-negocio --admin-email yo@ejemplo.com --dry-run`
(quita `--dry-run` para guardarlo).
