/**
 * Low-level HTTP client for the HivemindOS SuperAgent API.
 *
 * Docs: https://hivemindos.app/superagent-api/docs/
 * OpenAPI: https://api.hivemindos.app/openapi.json
 *
 * Authentication is a Bearer <redacted> API key. Every mutation / spending call must
 * carry a unique `Idempotency-Key` header (reusing a key with different input is
 * rejected server-side), so this client generates one automatically unless the
 * caller supplies its own.
 */

export const DEFAULT_BASE_URL = "https://api.hivemindos.app/v1";

/**
 * The API sits behind Cloudflare bot management. Default non-browser HTTP
 * clients get an HTTP 403 "error code: 1010" bot block; a browser-like
 * User-Agent passes. Verified 2026-10-03.
 */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface SuperAgentClientOptions {
  /** API key. Prefer the HIVEMINDOS_API_KEY env var; never commit a key. */
  apiKey: string;
  /** API base URL. Defaults to the production endpoint. */
  baseUrl?: string;
  /** Optional Hall app id (app_<12 hex>). Sent as X-HivemindOS-App. */
  appId?: string;
  /** Optional X-HivemindOS-Project selector for account-level keys. */
  projectId?: string;
  /** Request timeout in ms. */
  timeoutMs?: number;
  /** Custom fetch implementation (used by tests). */
  fetchImpl?: typeof fetch;
}

export class SuperAgentAPIError extends Error {
  readonly statusCode: number;
  readonly body: unknown;

  constructor(statusCode: number, message: string, body: unknown = undefined) {
    super(`SuperAgent API error ${statusCode}: ${message}`);
    this.name = "SuperAgentAPIError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

export interface InvokeParams {
  /** Short operation id (e.g. "memory.create") or full id from /actions. */
  operationId?: string;
  /** Raw path for path-style capabilities (alternative to operationId). */
  path?: string;
  method?: string;
  pathParameters?: Record<string, string>;
  query?: Record<string, unknown>;
  /** Operation input payload. */
  input?: Record<string, unknown>;
  connectionId?: string;
  approvalId?: string;
  /** Override the auto-generated idempotency key. */
  idempotencyKey?: string;
}

export class SuperAgentClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly appId?: string;
  private readonly projectId?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SuperAgentClientOptions) {
    if (!options.apiKey) {
      throw new Error(
        "An API key is required. Pass apiKey or set HIVEMINDOS_API_KEY."
      );
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.appId = options.appId;
    this.projectId = options.projectId;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Create a client from the HIVEMINDOS_API_KEY environment variable. */
  static fromEnv(
    overrides: Partial<SuperAgentClientOptions> = {}
  ): SuperAgentClient {
    const apiKey = process.env.HIVEMINDOS_API_KEY;
    if (!apiKey) {
      throw new Error("HIVEMINDOS_API_KEY environment variable is not set.");
    }
    return new SuperAgentClient({ apiKey, ...overrides });
  }

  /** Generate a fresh idempotency key (uuid hex, fits the API's pattern). */
  static newIdempotencyKey(): string {
    return crypto.randomUUID().replace(/-/g, "");
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "User-Agent": BROWSER_USER_AGENT,
      Accept: "application/json",
      ...extra,
    };
    if (this.appId) headers["X-HivemindOS-App"] = this.appId;
    if (this.projectId) headers["X-HivemindOS-Project"] = this.projectId;
    return headers;
  }

  private async handle<T>(response: Response): Promise<T> {
    const text = await response.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // keep raw text
    }
    if (!response.ok) {
      const message =
        typeof data === "object" && data !== null && "message" in data
          ? String((data as Record<string, unknown>).message)
          : text.slice(0, 500) || response.statusText;
      throw new SuperAgentAPIError(response.status, message, data);
    }
    return data as T;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: {
      params?: Record<string, unknown>;
      body?: unknown;
      headers?: Record<string, string>;
    } = {}
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, String(v));
        }
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url.toString(), {
        method,
        headers: this.headers(opts.headers),
        body:
          opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      return await this.handle<T>(response);
    } finally {
      clearTimeout(timer);
    }
  }

  private get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    return this.request<T>("GET", path, { params });
  }

  /** POST helper that always attaches a unique Idempotency-Key. */
  private post<T>(
    path: string,
    body: unknown,
    idempotencyKey?: string
  ): Promise<T> {
    return this.request<T>("POST", path, {
      body,
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key":
          idempotencyKey ?? SuperAgentClient.newIdempotencyKey(),
      },
    });
  }

  // ------------------------------------------------------------------ #
  // API conveniences
  // ------------------------------------------------------------------ #

  /** List the managed services this API key can use. */
  async listServices(): Promise<Record<string, unknown>[]> {
    const data = await this.get<{ services?: unknown } | unknown[]>(
      "/services"
    );
    if (Array.isArray(data)) return data as Record<string, unknown>[];
    if (data && typeof data === "object" && "services" in data) {
      return (
        (data as { services: Record<string, unknown>[] }).services ?? []
      );
    }
    return [];
  }

  /** Search actions available to this API key. mode: "read" | "write" | "execute". */
  async searchActions(
    params: {
      query?: string;
      actionId?: string;
      serviceId?: string;
      mode?: string;
      limit?: number;
    } = {}
  ): Promise<Record<string, unknown>[]> {
    const data = await this.get<Record<string, unknown>>("/actions", {
      query: params.query,
      actionId: params.actionId,
      serviceId: params.serviceId,
      mode: params.mode,
      limit: params.limit ?? 20,
    });
    const actions = data.actions ?? data.items;
    return Array.isArray(actions)
      ? (actions as Record<string, unknown>[])
      : [];
  }

  /**
   * Invoke a managed service operation.
   *
   * Provide either `operationId` (short, e.g. "memory.create", or the full
   * `services.invoke.<service>.<op>` id from /actions) or a raw `path`.
   */
  async invoke(
    serviceId: string,
    params: InvokeParams = {}
  ): Promise<unknown> {
    const body: Record<string, unknown> = { method: params.method ?? "POST" };
    if (params.operationId) body.operationId = params.operationId;
    if (params.path) body.path = params.path;
    if (params.pathParameters) body.pathParameters = params.pathParameters;
    if (params.query) body.query = params.query;
    if (params.input !== undefined) body.input = params.input;
    if (params.connectionId) body.connectionId = params.connectionId;
    if (params.approvalId) body.approvalId = params.approvalId;
    return this.post(
      `/services/${serviceId}/invoke`,
      body,
      params.idempotencyKey
    );
  }

  /** Read the account credit balance. */
  async creditBalance(): Promise<unknown> {
    const data = await this.get<Record<string, unknown>>("/credits/balance");
    return data.credits ?? data;
  }

  /** Read server-owned service pricing. */
  async pricing(): Promise<unknown> {
    return this.get("/pricing");
  }
}
