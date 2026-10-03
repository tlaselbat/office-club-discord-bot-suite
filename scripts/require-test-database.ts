const databaseUrl = process.env.TEST_DATABASE_URL;

if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
  throw new Error('TEST_DATABASE_URL is required for this database-backed test command.');
}

try {
  const parsed = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('TEST_DATABASE_URL must be a PostgreSQL connection URL.');
  }
} catch (error) {
  if (error instanceof Error) throw error;
  throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL connection URL.');
}
