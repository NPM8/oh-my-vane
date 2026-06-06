export const register = async () => {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      console.log('Running database migrations...');
      await import('./lib/db/migrate');
      console.log('Database migrations completed successfully');
    } catch (error) {
      console.error('Failed to run database migrations:', error);
    }

    await import('./lib/config/index');

    // Ensure a stable JWT secret exists before any request is served, so that
    // route handlers and middleware (separate module contexts) all read the
    // same persisted value rather than each generating its own.
    const { ensureJwtSecret } = await import('./lib/auth/authConfig');
    ensureJwtSecret();
  }
};
