import { createHash } from 'node:crypto';

export function assetContentVersion(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
