/**
 * Tests for the ElizaOS SuperAgent plugin. All HTTP is mocked — no network,
 * no credits, no real keys. Dummy key strings only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IAgentRuntime, Memory } from "@elizaos/core";

// The VM's no_proxy/NO_PROXY contains an entry this environment's HTTP stack
// can't parse; the client doesn't use proxies, so sanitize for the test run.
for (const key of ["no_proxy", "NO_PROXY", "http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY"]) {
  delete process.env[key];
}

import {
  extractParams,
  getCreditBalanceAction,
  getPricingAction,
  invokeServiceAction,
  listServicesAction,
  memoryReadAction,
  memoryWriteAction,
  searchActionsAction,
  superAgentActions,
} from "../src/actions.js";
import superAgentPlugin from "../src/index.js";
import { BROWSER_USER_AGENT, SuperAgentClient } from "../src/client.js";

const DUMMY_KEY = "hmos_dummy_key_for_tests";

function fakeRuntime(key: string | null = DUMMY_KEY): IAgentRuntime {
  return {
    getSetting: (k: string) =>
      k === "HIVEMINDOS_API_KEY" ? key : null,
  } as unknown as IAgentRuntime;
}

function fakeMessage(text: string): Memory {
  return { content: { text } } as Memory;
}

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function mockFetch(routes: Record<string, unknown>) {
  const recorded: RecordedRequest[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>)
    );
    let body: unknown;
    try {
      body = init.body ? JSON.parse(String(init.body)) : undefined;
    } catch {
      body = init.body;
    }
    recorded.push({ url, method: init.method ?? "GET", headers, body });
    const parsed = new URL(url);
    const payload = routes[parsed.pathname] ?? {};
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { fetchImpl, recorded };
}

function failingFetch(status: number, message: string) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ message }), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

describe("plugin export shape", () => {
  it("exports a valid ElizaOS Plugin", () => {
    expect(superAgentPlugin.name).toBe("superagent");
    expect(typeof superAgentPlugin.description).toBe("string");
    expect(superAgentPlugin.description.length).toBeGreaterThan(20);
    expect(Array.isArray(superAgentPlugin.actions)).toBe(true);
    expect(superAgentPlugin.actions).toHaveLength(7);
  });

  it("every action has the required ElizaOS fields", () => {
    const names = new Set<string>();
    for (const action of superAgentActions) {
      expect(typeof action.name).toBe("string");
      expect(action.name.length).toBeGreaterThan(0);
      expect(names.has(action.name)).toBe(false);
      names.add(action.name);
      expect(typeof action.description).toBe("string");
      expect(typeof action.validate).toBe("function");
      expect(typeof action.handler).toBe("function");
      expect(Array.isArray(action.similes)).toBe(true);
      expect(action.similes!.length).toBeGreaterThan(0);
      expect(Array.isArray(action.examples)).toBe(true);
      expect(action.examples!.length).toBeGreaterThan(0);
    }
  });

  it("action names are unique across the plugin", () => {
    const names = (superAgentPlugin.actions ?? []).map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("validate", () => {
  it("returns true when the key is in runtime settings", async () => {
    for (const action of superAgentActions) {
      await expect(
        action.validate(fakeRuntime(), fakeMessage("hi"))
      ).resolves.toBe(true);
    }
  });

  it("falls back to the HIVEMINDOS_API_KEY env var", async () => {
    process.env.HIVEMINDOS_API_KEY = DUMMY_KEY;
    try {
      await expect(
        listServicesAction.validate(fakeRuntime(null), fakeMessage("hi"))
      ).resolves.toBe(true);
    } finally {
      delete process.env.HIVEMINDOS_API_KEY;
    }
  });

  it("returns false when no key is available anywhere", async () => {
    delete process.env.HIVEMINDOS_API_KEY;
    const runtime = {
      getSetting: () => {
        throw new Error("not configured");
      },
    } as unknown as IAgentRuntime;
    await expect(
      listServicesAction.validate(runtime, fakeMessage("hi"))
    ).resolves.toBe(false);
  });
});

describe("extractParams", () => {
  it("parses a JSON payload from the message text", () => {
    const params = extractParams(
      fakeMessage(
        'please run {"serviceId": "cloud-superbrain", "operationId": "memory.create"} now'
      )
    );
    expect(params.serviceId).toBe("cloud-superbrain");
    expect(params.operationId).toBe("memory.create");
  });

  it("maps plain text to { text }", () => {
    const params = extractParams(fakeMessage("what can you do?"));
    expect(params).toEqual({ text: "what can you do?" });
  });

  it("ignores malformed JSON and falls back to text", () => {
    const params = extractParams(fakeMessage("oops {not json"));
    expect(params).toEqual({ text: "oops {not json" });
  });
});

describe("handlers (mocked HTTP)", () => {
  beforeEach(() => {
    delete process.env.HIVEMINDOS_API_KEY;
  });

  it("SUPERAGENT_LIST_SERVICES lists and filters services", async () => {
    const { fetchImpl, recorded } = mockFetch({
      "/v1/services": {
        services: [
          { id: "cloud-superbrain", title: "Memory" },
          { id: "media-service", title: "Media" },
        ],
      },
    });
    const runtime = {
      getSetting: (k: string) => (k === "HIVEMINDOS_API_KEY" ? DUMMY_KEY : null),
    } as unknown as IAgentRuntime;
    // inject the mock via a client built with fetchImpl by monkey-patching global fetch
    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = fetchImpl;
    try {
      const result = await listServicesAction.handler(
        runtime,
        fakeMessage('{"nameFilter": "memory"}'),
        undefined,
        undefined,
        undefined
      );
      expect(result?.success).toBe(true);
      expect(result?.text).toContain("cloud-superbrain");
      expect(result?.text).not.toContain("media-service");
      expect(recorded).toHaveLength(1);
      expect(recorded[0].url).toContain("/v1/services");
      expect(recorded[0].headers["User-Agent"]).toBe(BROWSER_USER_AGENT);
      expect(recorded[0].headers.Authorization).toBe(`Bearer ${DUMMY_KEY}`);
    } finally {
      (globalThis as Record<string, unknown>).fetch = origFetch;
    }
  });

  it("SUPERAGENT_SEARCH_ACTIONS passes query params", async () => {
    const { fetchImpl, recorded } = mockFetch({
      "/v1/actions": { actions: [{ id: "memory.create" }] },
    });
    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = fetchImpl;
    try {
      const result = await searchActionsAction.handler(
        fakeRuntime(),
        fakeMessage("recall memory"),
        undefined,
        undefined,
        undefined
      );
      expect(result?.success).toBe(true);
      expect(result?.text).toContain("memory.create");
      const url = new URL(recorded[0].url);
      expect(url.searchParams.get("query")).toBe("recall memory");
      expect(url.searchParams.get("limit")).toBe("20");
    } finally {
      (globalThis as Record<string, unknown>).fetch = origFetch;
    }
  });

  it("SUPERAGENT_INVOKE_SERVICE posts with an idempotency key", async () => {
    const { fetchImpl, recorded } = mockFetch({
      "/v1/services/cloud-superbrain/invoke": { ok: true },
    });
    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = fetchImpl;
    try {
      const result = await invokeServiceAction.handler(
        fakeRuntime(),
        fakeMessage(
          '{"serviceId": "cloud-superbrain", "operationId": "memory.create", "input": {"text": "hi"}}'
        ),
        undefined,
        undefined,
        undefined
      );
      expect(result?.success).toBe(true);
      expect(recorded).toHaveLength(1);
      expect(recorded[0].method).toBe("POST");
      expect(recorded[0].url).toContain("/v1/services/cloud-superbrain/invoke");
      const key = recorded[0].headers["Idempotency-Key"];
      expect(key).toMatch(/^[A-Za-z0-9:._-]+$/);
      expect((recorded[0].body as Record<string, unknown>).operationId).toBe(
        "memory.create"
      );
    } finally {
      (globalThis as Record<string, unknown>).fetch = origFetch;
    }
  });

  it("SUPERAGENT_INVOKE_SERVICE asks for serviceId/operationId when missing", async () => {
    const result = await invokeServiceAction.handler(
      fakeRuntime(),
      fakeMessage("do something"),
      undefined,
      undefined,
      undefined
    );
    expect(result?.success).toBe(true);
    expect(result?.text).toContain("Missing serviceId or operationId");
  });

  it("SUPERAGENT_GET_CREDIT_BALANCE reads the balance", async () => {
    const { fetchImpl } = mockFetch({
      "/v1/credits/balance": { credits: { balanceCredits: 0 } },
    });
    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = fetchImpl;
    try {
      const result = await getCreditBalanceAction.handler(
        fakeRuntime(),
        fakeMessage("balance?"),
        undefined,
        undefined,
        undefined
      );
      expect(result?.success).toBe(true);
      expect(result?.text).toContain("balanceCredits");
    } finally {
      (globalThis as Record<string, unknown>).fetch = origFetch;
    }
  });

  it("SUPERAGENT_GET_PRICING reads pricing", async () => {
    const { fetchImpl, recorded } = mockFetch({
      "/v1/pricing": { models: [] },
    });
    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = fetchImpl;
    try {
      const result = await getPricingAction.handler(
        fakeRuntime(),
        fakeMessage("pricing?"),
        undefined,
        undefined,
        undefined
      );
      expect(result?.success).toBe(true);
      expect(recorded[0].url).toContain("/v1/pricing");
    } finally {
      (globalThis as Record<string, unknown>).fetch = origFetch;
    }
  });

  it("SUPERAGENT_MEMORY_WRITE calls memory.create on cloud-superbrain", async () => {
    const { fetchImpl, recorded } = mockFetch({
      "/v1/services/cloud-superbrain/invoke": { stored: true },
    });
    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = fetchImpl;
    try {
      const result = await memoryWriteAction.handler(
        fakeRuntime(),
        fakeMessage('{"text": "Pixel prefers concise briefs", "tags": "prefs, briefs"}'),
        undefined,
        undefined,
        undefined
      );
      expect(result?.success).toBe(true);
      const body = recorded[0].body as Record<string, unknown>;
      expect(body.operationId).toBe("memory.create");
      expect(
        (body.input as Record<string, unknown>).text
      ).toBe("Pixel prefers concise briefs");
      expect((body.input as Record<string, unknown>).tags).toEqual([
        "prefs",
        "briefs",
      ]);
      expect(recorded[0].headers["Idempotency-Key"]).toMatch(
        /^[A-Za-z0-9:._-]+$/
      );
    } finally {
      (globalThis as Record<string, unknown>).fetch = origFetch;
    }
  });

  it("SUPERAGENT_MEMORY_READ calls memory.recall and clamps the limit", async () => {
    const { fetchImpl, recorded } = mockFetch({
      "/v1/services/cloud-superbrain/invoke": { memories: [] },
    });
    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = fetchImpl;
    try {
      const result = await memoryReadAction.handler(
        fakeRuntime(),
        fakeMessage('{"query": "briefs", "limit": 500}'),
        undefined,
        undefined,
        undefined
      );
      expect(result?.success).toBe(true);
      const body = recorded[0].body as Record<string, unknown>;
      expect(body.operationId).toBe("memory.recall");
      expect((body.input as Record<string, unknown>).limit).toBe(50);
    } finally {
      (globalThis as Record<string, unknown>).fetch = origFetch;
    }
  });

  it("invokes the callback with the result text when provided", async () => {
    const { fetchImpl } = mockFetch({
      "/v1/credits/balance": { credits: { balanceCredits: 0 } },
    });
    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = fetchImpl;
    try {
      const seen: string[] = [];
      const result = await getCreditBalanceAction.handler(
        fakeRuntime(),
        fakeMessage("balance?"),
        undefined,
        undefined,
        async (response) => {
          seen.push(response.text ?? "");
          return [];
        }
      );
      expect(result?.success).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toContain("balanceCredits");
    } finally {
      (globalThis as Record<string, unknown>).fetch = origFetch;
    }
  });

  it("returns a failed ActionResult on API errors (no throw)", async () => {
    const origFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = failingFetch(
      402,
      "insufficient credits"
    );
    try {
      const result = await getCreditBalanceAction.handler(
        fakeRuntime(),
        fakeMessage("balance?"),
        undefined,
        undefined,
        undefined
      );
      expect(result?.success).toBe(false);
      expect(result?.text).toContain("402");
      expect(result?.text).toContain("insufficient credits");
    } finally {
      (globalThis as Record<string, unknown>).fetch = origFetch;
    }
  });

  it("returns a failed ActionResult when no API key is configured", async () => {
    delete process.env.HIVEMINDOS_API_KEY;
    const result = await getCreditBalanceAction.handler(
      fakeRuntime(null),
      fakeMessage("balance?"),
      undefined,
      undefined,
      undefined
    );
    expect(result?.success).toBe(false);
    expect(result?.text).toContain("HIVEMINDOS_API_KEY");
  });
});

describe("client", () => {
  it("generates unique idempotency keys matching the API pattern", () => {
    const a = SuperAgentClient.newIdempotencyKey();
    const b = SuperAgentClient.newIdempotencyKey();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9:._-]+$/);
  });

  it("throws fromEnv when the env var is missing", () => {
    delete process.env.HIVEMINDOS_API_KEY;
    expect(() => SuperAgentClient.fromEnv()).toThrow("HIVEMINDOS_API_KEY");
  });

  it("sends the browser User-Agent (Cloudflare workaround)", async () => {
    const { fetchImpl, recorded } = mockFetch({ "/v1/services": [] });
    const client = new SuperAgentClient({
      apiKey: DUMMY_KEY,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.listServices();
    expect(recorded[0].headers["User-Agent"]).toBe(BROWSER_USER_AGENT);
  });

  it("never leaks the key into action schemas or descriptions", () => {
    const haystack = JSON.stringify(
      superAgentActions.map((a) => ({
        name: a.name,
        description: a.description,
        similes: a.similes,
      }))
    );
    expect(haystack).not.toContain(DUMMY_KEY);
    expect(haystack).not.toMatch(/bk_[A-Za-z0-9_-]{8,}/);
  });
});
