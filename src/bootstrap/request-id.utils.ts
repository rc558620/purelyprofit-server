import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export function createRequestIdGenerator(): (req: IncomingMessage) => string {
  return (req: IncomingMessage): string => {
    const header = req.headers['x-request-id'];
    const value = Array.isArray(header) ? header[0] : header;
    return value ?? crypto.randomUUID();
  };
}
