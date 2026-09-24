import {
  dathostFileSchema,
  dathostServerSchema,
  type DatHostFile,
  type DatHostServer,
} from './schemas.js';
import { z } from 'zod';

export interface DatHostClientOptions {
  email: string;
  password: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class DatHostClient {
  private readonly request: typeof fetch;
  private readonly baseUrl: URL;
  private readonly authorization: string;
  private readonly timeoutMs: number;

  public constructor(options: DatHostClientOptions) {
    this.request = options.fetch ?? fetch;
    this.baseUrl = new URL(options.baseUrl ?? 'https://dathost.net/api/0.1/');
    this.authorization = `Basic ${Buffer.from(`${options.email}:${options.password}`).toString('base64')}`;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  public listServers(): Promise<DatHostServer[]> {
    return this.json('game-servers', z.array(dathostServerSchema));
  }

  public getServer(serverId: string): Promise<DatHostServer | null> {
    return this.json(`game-servers/${encodeURIComponent(serverId)}`, dathostServerSchema, true);
  }

  public createProvisionalServer(
    fields: Readonly<Record<string, string | number | boolean>>,
  ): Promise<DatHostServer> {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.set(key, String(value));
    return this.json('game-servers', dathostServerSchema, false, { method: 'POST', body });
  }

  public duplicateServer(
    templateId: string,
    location: string,
    destinationServerId?: string,
  ): Promise<DatHostServer> {
    const body = new FormData();
    body.set('location', location);
    if (destinationServerId !== undefined) body.set('destination_server_id', destinationServerId);
    return this.json(
      `game-servers/${encodeURIComponent(templateId)}/duplicate`,
      dathostServerSchema,
      false,
      { method: 'POST', body },
    );
  }

  public updateServer(
    serverId: string,
    fields: Readonly<Record<string, string | number | boolean>>,
  ): Promise<DatHostServer> {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.set(key, String(value));
    return this.json(`game-servers/${encodeURIComponent(serverId)}`, dathostServerSchema, false, {
      method: 'PUT',
      body,
    });
  }

  public async startServer(serverId: string): Promise<void> {
    await this.empty(`game-servers/${encodeURIComponent(serverId)}/start`, 'POST');
  }

  public async stopServer(serverId: string): Promise<void> {
    await this.empty(`game-servers/${encodeURIComponent(serverId)}/stop`, 'POST', true);
  }

  public async deleteServer(serverId: string): Promise<void> {
    await this.empty(`game-servers/${encodeURIComponent(serverId)}`, 'DELETE', true);
  }

  public listFiles(serverId: string, path?: string): Promise<DatHostFile[]> {
    const params = new URLSearchParams();
    if (path !== undefined && path.length > 0) params.set('path', path);
    const query = params.toString();
    return this.json(
      `game-servers/${encodeURIComponent(serverId)}/files${query ? `?${query}` : ''}`,
      z.array(dathostFileSchema),
    );
  }

  public downloadFile(serverId: string, filePath: string): Promise<Response> {
    if (/\.\.|^\/|\\/u.test(filePath)) {
      throw new Error('Invalid DatHost file path');
    }
    return this.fetch(
      `game-servers/${encodeURIComponent(serverId)}/files/${encodeURIComponent(filePath)}`,
    );
  }

  public async sendConsole(serverId: string, line: string): Promise<void> {
    if (/[\r\n]/u.test(line)) throw new Error('Console command must be one line');
    const body = new FormData();
    body.set('line', line);
    await this.fetch(`game-servers/${encodeURIComponent(serverId)}/console`, {
      method: 'POST',
      body,
    });
  }

  private async json<T>(
    path: string,
    schema: z.ZodType<T>,
    missingAsNull = false,
    init?: RequestInit,
  ): Promise<T> {
    const response = await this.fetch(path, init);
    if (missingAsNull && response.status === 404) return null as T;
    if (!response.ok)
      throw new Error(`DatHost request failed with status ${String(response.status)}`);
    return schema.parse(await response.json());
  }

  private async empty(path: string, method: string, missingIsSuccess = false): Promise<void> {
    const response = await this.fetch(path, { method });
    if (!response.ok && !(missingIsSuccess && response.status === 404)) {
      throw new Error(`DatHost request failed with status ${String(response.status)}`);
    }
  }

  private fetch(path: string, init?: RequestInit): Promise<Response> {
    return this.request(new URL(path, this.baseUrl), {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers).entries()),
        authorization: this.authorization,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }
}
