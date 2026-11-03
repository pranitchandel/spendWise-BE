import { createServer } from 'node:http';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { createApp } from './app.js';
import { logger } from './shared/utils/logger.js';

function safeErrorDetails(error: unknown) {
  if (!(error instanceof Error)) {
    return { errorName: 'UnknownError', errorMessage: 'An unknown startup error occurred' };
  }

  const errorWithCode = error as Error & { code?: string | number };
  const errorMessage = error.message.replace(/mongodb(?:\+srv)?:\/\/[^\s"']+/gi, '[redacted MongoDB URI]');
  return {
    errorName: error.name,
    errorCode: errorWithCode.code,
    errorMessage,
  };
}

async function start() {
  await connectDatabase();
  const server = createServer(createApp());

  server.once('error', (error: NodeJS.ErrnoException) => {
    logger.error(safeErrorDetails(error), 'SpendWise API failed to listen');
    void disconnectDatabase().finally(() => {
      process.exitCode = 1;
    });
  });

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'SpendWise API listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'SpendWise API shutting down');
    server.close(() => {
      void disconnectDatabase().finally(() => process.exit(0));
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error: unknown) => {
  logger.error(safeErrorDetails(error), 'SpendWise API failed to start');
  void disconnectDatabase().finally(() => {
    process.exitCode = 1;
  });
});