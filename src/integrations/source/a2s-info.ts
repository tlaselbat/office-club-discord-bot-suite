import { createSocket, type Socket } from 'node:dgram';
import { isIP } from 'node:net';

const HEADER = Buffer.from([0xff, 0xff, 0xff, 0xff]);
const INFO_REQUEST = Buffer.concat([
  HEADER,
  Buffer.from([0x54]),
  Buffer.from('Source Engine Query\0'),
]);
const RESPONSE_HEADER_LENGTH = 5;
const CHALLENGE_RESPONSE = 0x41;
const INFO_RESPONSE = 0x49;
const DEFAULT_TIMEOUT_MS = 2_000;
const MAX_CHALLENGE_ROUNDS = 1;

export type A2sInfoQuery = (address: string, port: number) => Promise<string>;

export interface A2sInfoQueryOptions {
  timeoutMs?: number;
  createSocket?: () => Socket;
}

/**
 * Reads the map reported by a running Source server using A2S_INFO.
 *
 * A connected UDP socket intentionally limits responses to the queried endpoint.
 */
export function createA2sInfoQuery(options: A2sInfoQueryOptions = {}): A2sInfoQuery {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_TIMEOUT_MS)
    throw new Error('A2S_INFO timeout must be between 1 and 2000 milliseconds');
  const socketFactory = options.createSocket ?? (() => createSocket('udp4'));
  return (address: string, port: number) => query(address, port, socketFactory, timeoutMs);
}

export const queryA2sCurrentMap = createA2sInfoQuery();

function query(
  address: string,
  port: number,
  socketFactory: () => Socket,
  timeoutMs: number,
): Promise<string> {
  if (isIP(address) !== 4) return Promise.reject(new Error('A2S_INFO requires an IPv4 address'));
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    return Promise.reject(new Error('A2S_INFO requires a valid UDP port'));
  return new Promise((resolve, reject) => {
    const socket = socketFactory();
    let settled = false;
    let challengeRounds = 0;
    const timeout = setTimeout(() => finish(new Error('A2S_INFO timed out')), timeoutMs);

    const finish = (result: string | Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.removeAllListeners('message');
      socket.removeAllListeners('connect');
      try {
        socket.close();
      } catch {
        // The socket may already have closed after a transport error.
      }
      if (typeof result === 'string') resolve(result);
      else reject(result);
    };

    const send = (packet: Buffer): void => {
      if (settled) return;
      try {
        socket.send(packet, (error) => {
          if (error !== null) finish(error);
        });
      } catch (error: unknown) {
        finish(error instanceof Error ? error : new Error('A2S_INFO send failed'));
      }
    };

    socket.on('error', (error) => finish(error));
    socket.once('connect', () => send(INFO_REQUEST));
    socket.on('message', (packet, remote) => {
      try {
        const expected = socket.remoteAddress();
        if (remote.address !== expected.address || remote.port !== expected.port)
          throw new Error('A2S_INFO response came from an unexpected sender');
        const responseType = readResponseType(packet);
        if (responseType === CHALLENGE_RESPONSE) {
          if (challengeRounds >= MAX_CHALLENGE_ROUNDS)
            throw new Error('A2S_INFO exceeded the challenge limit');
          if (packet.length !== RESPONSE_HEADER_LENGTH + 4)
            throw new Error('A2S_INFO challenge response is malformed');
          challengeRounds += 1;
          send(Buffer.concat([INFO_REQUEST, packet.subarray(RESPONSE_HEADER_LENGTH)]));
          return;
        }
        if (responseType !== INFO_RESPONSE)
          throw new Error('A2S_INFO returned an unexpected response');
        finish(parseMap(packet));
      } catch (error: unknown) {
        finish(error instanceof Error ? error : new Error('A2S_INFO response is malformed'));
      }
    });
    try {
      socket.connect(port, address);
    } catch (error: unknown) {
      finish(error instanceof Error ? error : new Error('A2S_INFO connection failed'));
    }
  });
}

function readResponseType(packet: Buffer): number {
  if (packet.length < RESPONSE_HEADER_LENGTH) throw new Error('A2S_INFO response is truncated');
  if (!packet.subarray(0, HEADER.length).equals(HEADER)) {
    if (packet.readInt32LE(0) === -2) throw new Error('A2S_INFO split responses are unsupported');
    throw new Error('A2S_INFO response has an invalid header');
  }
  return (
    packet[4] ??
    (() => {
      throw new Error('A2S_INFO response is truncated');
    })()
  );
}

function parseMap(packet: Buffer): string {
  let offset = RESPONSE_HEADER_LENGTH;
  if (packet.length <= offset) throw new Error('A2S_INFO info response is truncated');
  offset += 1; // protocol version
  const serverName = readNulString(packet, offset);
  const map = readNulString(packet, serverName.nextOffset);
  const folder = readNulString(packet, map.nextOffset);
  const game = readNulString(packet, folder.nextOffset);
  if (packet.length < game.nextOffset + 9) throw new Error('A2S_INFO info response is truncated');
  readNulString(packet, game.nextOffset + 9); // version
  if (
    map.value.trim().length === 0 ||
    map.value.length > 128 ||
    Buffer.from(map.value).some((byte) => byte < 32 || byte === 127)
  ) {
    throw new Error('A2S_INFO returned an invalid map');
  }
  return map.value;
}

function readNulString(packet: Buffer, offset: number): { value: string; nextOffset: number } {
  const terminator = packet.indexOf(0, offset);
  if (terminator === -1) throw new Error('A2S_INFO response has an unterminated string');
  return {
    value: packet.subarray(offset, terminator).toString('utf8'),
    nextOffset: terminator + 1,
  };
}
