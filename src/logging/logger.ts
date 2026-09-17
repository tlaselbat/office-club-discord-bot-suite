import pino, { type Logger } from 'pino';

const redactPaths = [
  'discordToken',
  'discordClientSecret',
  'panelSessionSecret',
  'dathostPassword',
  'rconPassword',
  'joinPassword',
  'token',
  'authorization',
  'req.headers.authorization',
  'req.headers.x-matchzy-token',
  '*.discordToken',
  '*.discordClientSecret',
  '*.panelSessionSecret',
  '*.dathostPassword',
  '*.rconPassword',
  '*.joinPassword',
  '*.token',
];

export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: { paths: redactPaths, censor: '[REDACTED]' },
    base: null,
  });
}
