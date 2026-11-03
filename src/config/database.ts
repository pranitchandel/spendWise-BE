import { setServers } from 'node:dns/promises';
import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../shared/utils/logger.js';

export async function connectDatabase(uri = env.MONGODB_URI): Promise<typeof mongoose> {
  const dnsServers = env.DNS_SERVERS.split(',').map((server) => server.trim()).filter(Boolean);
  if (dnsServers.length > 0) setServers(dnsServers);
  mongoose.set('strictQuery', true);
  const conn = await mongoose.connect(uri);
  logger.info({ db: conn.connection.name }, 'MongoDB connected');
  return conn;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
}
