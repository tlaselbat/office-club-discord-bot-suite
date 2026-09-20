import pino, { type DestinationStream, type Logger } from 'pino';

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
  'req.headers["x-matchzy-token"]',
  'req.headers.cookie',
  '*.discordToken',
  '*.discordClientSecret',
  '*.panelSessionSecret',
  '*.dathostPassword',
  '*.rconPassword',
  '*.joinPassword',
  '*.token',
];

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      redact: { paths: redactPaths, censor: '[REDACTED]' },
      base: null,
      serializers: {
        req: (request: { method?: string; url?: string; hostname?: string; ip?: string }) => ({
          method: request.method,
          // Callback queries and Steam challenge paths carry authentication secrets.
          url: request.url
            ?.split('?')[0]
            ?.replace(/(\/auth\/steam\/start\/)[^/]*/iu, '$1[REDACTED]'),
          host: request.hostname,
          remoteAddress: request.ip,
        }),
      },
    },
    destination,
  );
}
