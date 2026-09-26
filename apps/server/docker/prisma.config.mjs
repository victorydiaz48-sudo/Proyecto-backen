// Runtime config for `prisma migrate deploy` inside the container. Plain
// object (no imports) so it works without the project's node_modules.
export default {
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL },
};
