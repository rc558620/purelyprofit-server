import { randomBytes } from 'node:crypto';

export const hashScanOrderRequest = (payload: unknown): string => {
  const json = JSON.stringify(payload);
  let hash = 0;
  for (let index = 0; index < json.length; index += 1) {
    hash = (hash << 5) - hash + json.charCodeAt(index);
    hash |= 0;
  }
  return hash.toString(16);
};

export const createScanOrderNo = (): string =>
  `SO${Date.now()}${randomBytes(3).toString('hex').toUpperCase()}`;
