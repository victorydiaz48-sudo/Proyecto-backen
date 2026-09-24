import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Las migraciones las aplica el propietario del esquema; la app usa DATABASE_URL (rol reservas_app,
    // sujeto a Row-Level Security). En local sin MIGRATION_DATABASE_URL se usa DATABASE_URL.
    // Vacía solo vale para `prisma generate` (build sin BD); migrar sin URL falla con un error claro.
    url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
    // Solo para 'prisma migrate diff' (detección de drift en CI); 'migrate dev' crea su propia BD sombra.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
