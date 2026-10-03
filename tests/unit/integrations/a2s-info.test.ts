import { createSocket, type Socket } from 'node:dgram';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createA2sInfoQuery } from '../../../src/integrations/source/a2s-info.js';

const header = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const servers: Socket[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(close));
});

describe('A2S_INFO current-map query', () => {
  it('returns the map from a direct A2S_INFO response', async () => {
    const server = await startServer((packet, remote, socket) => {
      expect(packet.subarray(0, 5)).toEqual(Buffer.concat([header, Buffer.from([0x54])]));
      socket.send(infoResponse('am_water_wf'), remote.port, remote.address);
    });

    await expect(query(server)).resolves.toBe('am_water_wf');
  });

  it('retries exactly once when the server requires a challenge', async () => {
    let requests = 0;
    const challenge = Buffer.from([1, 2, 3, 4]);
    const server = await startServer((packet, remote, socket) => {
      requests += 1;
      if (requests === 1) {
        socket.send(
          Buffer.concat([header, Buffer.from([0x41]), challenge]),
          remote.port,
          remote.address,
        );
        return;
      }
      expect(packet.subarray(-4)).toEqual(challenge);
      socket.send(infoResponse('de_ancient'), remote.port, remote.address);
    });

    await expect(query(server)).resolves.toBe('de_ancient');
    expect(requests).toBe(2);
  });

  it('fails closed for malformed, truncated, and split packets', async () => {
    for (const response of [
      Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49, 17, 0]),
      Buffer.from([0xfe, 0xff, 0xff, 0xff, 0x00]),
      Buffer.from([0xff, 0xff, 0xff, 0xff, 0x49, 17]),
    ]) {
      const server = await startServer((_packet, remote, socket) => {
        socket.send(response, remote.port, remote.address);
      });
      await expect(query(server)).rejects.toThrow(/A2S_INFO/u);
      await close(server);
    }
  });

  it('times out and closes its UDP socket', async () => {
    const server = await startServer(() => undefined);
    const sockets: Socket[] = [];
    let closed = false;
    const queryWithShortTimeout = createA2sInfoQuery({
      timeoutMs: 20,
      createSocket: () => {
        const socket = createSocket('udp4');
        socket.once('close', () => {
          closed = true;
        });
        sockets.push(socket);
        return socket;
      },
    });

    await expect(queryWithShortTimeout('127.0.0.1', port(server))).rejects.toThrow('timed out');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(sockets).toHaveLength(1);
    expect(closed).toBe(true);
  });

  it('stops repeated challenges after one retry', async () => {
    let requests = 0;
    const server = await startServer((_packet, remote, socket) => {
      requests += 1;
      socket.send(
        Buffer.concat([header, Buffer.from([0x41, 1, 2, 3, 4])]),
        remote.port,
        remote.address,
      );
    });
    await expect(query(server)).rejects.toThrow('challenge limit');
    expect(requests).toBe(2);
  });

  it.each(['connect', 'send'] as const)('cleans up a synchronous %s failure', async (method) => {
    const server = await startServer(() => undefined);
    const socket = createSocket('udp4');
    const closeSpy = vi.spyOn(socket, 'close');
    vi.spyOn(socket, method).mockImplementation(() => {
      throw new Error('transport failed');
    });
    const failingQuery = createA2sInfoQuery({ createSocket: () => socket });
    await expect(failingQuery('127.0.0.1', port(server))).rejects.toThrow('transport failed');
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it.each(['::1', 'example.invalid'])(
    'rejects unsupported endpoint %s before opening a socket',
    async (address) => {
      const factory = vi.fn(() => createSocket('udp4'));
      await expect(createA2sInfoQuery({ createSocket: factory })(address, 27015)).rejects.toThrow(
        'IPv4',
      );
      expect(factory).not.toHaveBeenCalled();
    },
  );
});

function query(server: Socket): Promise<string> {
  return createA2sInfoQuery({ timeoutMs: 500 })('127.0.0.1', port(server));
}

async function startServer(
  handler: (packet: Buffer, remote: { address: string; port: number }, socket: Socket) => void,
): Promise<Socket> {
  const server = createSocket('udp4');
  servers.push(server);
  server.on('message', (packet, remote) => handler(packet, remote, server));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.bind(0, '127.0.0.1', () => resolve());
  });
  return server;
}

function port(server: Socket): number {
  const address = server.address();
  if (typeof address === 'string') throw new Error('Expected a UDP address');
  return address.port;
}

function close(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    try {
      socket.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

function infoResponse(map: string): Buffer {
  return Buffer.concat([
    header,
    Buffer.from([0x49, 17]),
    Buffer.from(`ClickCS\0${map}\0csgo\0Counter-Strike 2\0`, 'utf8'),
    Buffer.alloc(9),
    Buffer.from('1.0.0\0', 'utf8'),
  ]);
}
