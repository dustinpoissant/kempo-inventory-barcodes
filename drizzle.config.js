/*
  Local/CI test-database setup only: this extension has no migrations of its own in production. Its
  tables are created at install time. The unit tier's in-memory database is built from this list:
  kempo's core tables, kempo-inventory's (items are read through its SDK) and this extension's own.

  A plain object, which is all drizzle-kit's `defineConfig` returns.
*/
export default {
  schema: [
    './server/db/schema.js',
    './node_modules/kempo/server/db/schema.js',
    './node_modules/kempo-inventory/server/db/schema.js',
  ],
  out: './server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
};
