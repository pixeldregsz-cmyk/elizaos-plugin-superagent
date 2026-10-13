/**
 * ElizaOS actions wrapping the HivemindOS SuperAgent API.
 *
 * Parameter convention: ElizaOS handlers receive the agent's message, not a
 * structured argument object. Handlers below accept parameters in two ways:
 *
 * 1. A JSON object embedded in the message text, e.g.
 *    `{"serviceId": "cloud-superbrain", "operationId": "memory.create",
 *      "input": {"text": "Pixel prefers concise briefs"}}`
 * 2. Plain text, mapped to the action's primary parameter (query/text).
 *
 * The model should prefer the JSON form for invoke/memory actions; plain text
 * works for discovery actions (list/search/balance/pricing).
 */

import type {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
} from "@elizaos/core";
import {
  SuperAgentAPIError,
  SuperAgentClient,
} from "./client.js";

/** Managed service that hosts memory (no standalone memory REST endpoints). */
export const MEMORY_SERVICE_ID = "cloud-superbrain";

const MAX_OUTPUT_CHARS = 8000;

function truncate(value: unknown): string {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > MAX_OUTPUT_CHARS
    ? text.slice(0, MAX_OUTPUT_CHARS)
    : text;
}

/** API key from runtime settings first, then the environment. */
function resolveApiKey(runtime: IAgentRuntime): string | undefined {
  try {
    const fromRuntime = runtime.getSetting("HIVEMINDOS_API_KEY");
    if (typeof fromRuntime === "string" && fromRuntime) return fromRuntime;
  } catch {
    // runtime.getSetting may throw when unconfigured; fall through to env
  }
  return process.env.HIVEMINDOS_API_KEY || undefined;
}

function resolveClient(runtime: IAgentRuntime): SuperAgentClient {
  const apiKey = resolveApiKey(runtime);
  if (!apiKey) {
    throw new Error(
      "HIVEMINDOS_API_KEY is not set. Add it to the agent's settings or environment."
    );
  }
  const pick = (key: string): string | undefined => {
    try {
      const v = runtime.getSetting(key);
      return typeof v === "string" && v ? v : undefined;
    } catch {
      return undefined;
    }
  };
  return new SuperAgentClient({
    apiKey,
    baseUrl: pick("HIVEMINDOS_BASE_URL"),
    appId: pick("HIVEMINDOS_APP_ID"),
    projectId: pick("HIVEMINDOS_PROJECT_ID"),
  });
}

/** Extract a parameter object from the message: JSON payload wins, else { text }. */
export function extractParams(message: Memory): Record<string, unknown> {
  const text = message.content?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]) as unknown;
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        return obj as Record<string, unknown>;
      }
    } catch {
      // fall through to plain-text mapping
    }
  }
  return { text };
}

function parseTags(tags: unknown): string[] | undefined {
  const raw =
    typeof tags === "string"
      ? tags
      : Array.isArray(tags)
        ? tags.join(",")
        : "";
  const list = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asInt(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) ? n : undefined;
}

/** validate: the action is available when an API key can be resolved. */
const hasApiKey = async (runtime: IAgentRuntime): Promise<boolean> =>
  Boolean(resolveApiKey(runtime));

/** Run the handler body, surface errors as a failed ActionResult. */
async function runAction(
  runtime: IAgentRuntime,
  message: Memory,
  callback: HandlerCallback | undefined,
  work: (
    client: SuperAgentClient,
    params: Record<string, unknown>
  ) => Promise<{ text: string; data?: Record<string, unknown> }>
): Promise<ActionResult> {
  try {
    const client = resolveClient(runtime);
    const params = extractParams(message);
    const { text, data } = await work(client, params);
    const result: ActionResult = { success: true, text, data };
    if (callback) {
      await callback({ text, source: "superagent" });
    }
    return result;
  } catch (error) {
    const messageText =
      error instanceof SuperAgentAPIError
        ? `SuperAgent API error ${error.statusCode}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    const result: ActionResult = {
      success: false,
      text: messageText,
      error: messageText,
    };
    if (callback) {
      await callback({ text: messageText, source: "superagent" });
    }
    return result;
  }
}

// ------------------------------------------------------------------ //
// Actions
// ------------------------------------------------------------------ //

export const listServicesAction: Action = {
  name: "SUPERAGENT_LIST_SERVICES",
  similes: [
    "LIST_SUPERAGENT_SERVICES",
    "SUPERAGENT_SERVICES",
    "WHAT_SUPERAGENT_SERVICES",
    "SHOW_SUPERAGENT_SERVICES",
  ],
  description:
    "List the managed services available to this SuperAgent API key " +
    "(models, memory, wallets, trading, media, automations, nft-agents, ...). " +
    "Start here to discover what the agent can do. " +
    'Accepts {"nameFilter": "..."} or plain text as a name filter.',
  validate: hasApiKey,
  handler: async (runtime, message, _state, _options, callback) =>
    runAction(runtime, message, callback, async (client, params) => {
      const services = await client.listServices();
      const filter = (
        asString(params.nameFilter) ?? asString(params.text) ?? ""
      ).toLowerCase();
      const filtered = filter
        ? services.filter((s) =>
            JSON.stringify(s).toLowerCase().includes(filter)
          )
        : services;
      return {
        text: truncate(
          filtered.map((s) => ({
            id: s.id,
            title: s.title ?? s.name,
            description: s.description,
          }))
        ),
        data: { count: filtered.length },
      };
    }),
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "What SuperAgent services can you use?" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll list the available SuperAgent services.",
          action: "SUPERAGENT_LIST_SERVICES",
        },
      },
    ],
    [
      {
        name: "{{user1}}",
        content: { text: 'Show me memory-related services: {"nameFilter": "memory"}' },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll filter the SuperAgent services for memory.",
          action: "SUPERAGENT_LIST_SERVICES",
        },
      },
    ],
  ],
};

export const searchActionsAction: Action = {
  name: "SUPERAGENT_SEARCH_ACTIONS",
  similes: [
    "SEARCH_SUPERAGENT_ACTIONS",
    "FIND_SUPERAGENT_ACTION",
    "LOOKUP_SUPERAGENT_OPERATION",
  ],
  description:
    "Search the 400+ invokable actions across SuperAgent managed services. " +
    "Use before invoking: find the exact operationId and its input shape. " +
    'Accepts {"query": "...", "actionId": "...", "serviceId": "...", ' +
    '"mode": "read|write|execute", "limit": 20} or plain text as the query.',
  validate: hasApiKey,
  handler: async (runtime, message, _state, _options, callback) =>
    runAction(runtime, message, callback, async (client, params) => {
      const query = asString(params.query) ?? asString(params.text);
      const limit = Math.max(1, Math.min(asInt(params.limit) ?? 20, 100));
      const results = await client.searchActions({
        query,
        actionId: asString(params.actionId),
        serviceId: asString(params.serviceId),
        mode: asString(params.mode),
        limit,
      });
      return {
        text: truncate(results),
        data: { count: results.length, query: query ?? null },
      };
    }),
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Find the SuperAgent action for recalling memory" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll search the SuperAgent action catalog.",
          action: "SUPERAGENT_SEARCH_ACTIONS",
        },
      },
    ],
  ],
};

export const invokeServiceAction: Action = {
  name: "SUPERAGENT_INVOKE_SERVICE",
  similes: [
    "INVOKE_SUPERAGENT",
    "CALL_SUPERAGENT_SERVICE",
    "SUPERAGENT_INVOKE",
    "RUN_SUPERAGENT_OPERATION",
  ],
  description:
    "Invoke a managed service operation on the SuperAgent API — the workhorse action. " +
    "Runs any of the 400+ operations across the managed services. " +
    "Mutations automatically get a unique Idempotency-Key header. " +
    "Charged calls spend API credits; check SUPERAGENT_GET_CREDIT_BALANCE first. " +
    'Requires a JSON payload: {"serviceId": "...", "operationId": "...", ' +
    '"input": {...}, "idempotencyKey": "optional-override"}.',
  validate: hasApiKey,
  handler: async (runtime, message, _state, _options, callback) =>
    runAction(runtime, message, callback, async (client, params) => {
      const serviceId = asString(params.serviceId);
      const operationId = asString(params.operationId);
      if (!serviceId || !operationId) {
        return {
          text:
            "Missing serviceId or operationId. Provide a JSON payload like " +
            '{"serviceId": "cloud-superbrain", "operationId": "memory.create", ' +
            '"input": {"text": "..."}}. Use SUPERAGENT_SEARCH_ACTIONS to find valid ids.',
        };
      }
      const input =
        params.input && typeof params.input === "object"
          ? (params.input as Record<string, unknown>)
          : {};
      const result = await client.invoke(serviceId, {
        operationId,
        input,
        idempotencyKey: asString(params.idempotencyKey),
      });
      return { text: truncate(result) };
    }),
  examples: [
    [
      {
        name: "{{user1}}",
        content: {
          text: 'Generate an image of a bee: {"serviceId": "media-service", "operationId": "image.generate", "input": {"prompt": "a bee"}}',
        },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll invoke that SuperAgent service operation.",
          action: "SUPERAGENT_INVOKE_SERVICE",
        },
      },
    ],
  ],
};

export const getCreditBalanceAction: Action = {
  name: "SUPERAGENT_GET_CREDIT_BALANCE",
  similes: [
    "SUPERAGENT_BALANCE",
    "CHECK_SUPERAGENT_CREDITS",
    "SUPERAGENT_CREDIT_BALANCE",
  ],
  description:
    "Read the SuperAgent account's credit balance. Invoke and other spending " +
    "operations are refused when the balance cannot cover them, so check this " +
    "before running paid work.",
  validate: hasApiKey,
  handler: async (runtime, message, _state, _options, callback) =>
    runAction(runtime, message, callback, async (client) => {
      const balance = await client.creditBalance();
      return { text: truncate(balance) };
    }),
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Do I have enough SuperAgent credits for this?" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll check the SuperAgent credit balance.",
          action: "SUPERAGENT_GET_CREDIT_BALANCE",
        },
      },
    ],
  ],
};

export const getPricingAction: Action = {
  name: "SUPERAGENT_GET_PRICING",
  similes: ["SUPERAGENT_PRICING", "CHECK_SUPERAGENT_PRICING"],
  description: "Read server-owned service pricing for the SuperAgent API.",
  validate: hasApiKey,
  handler: async (runtime, message, _state, _options, callback) =>
    runAction(runtime, message, callback, async (client) => {
      const pricing = await client.pricing();
      return { text: truncate(pricing) };
    }),
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "What does the SuperAgent API cost per service?" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll look up the SuperAgent pricing.",
          action: "SUPERAGENT_GET_PRICING",
        },
      },
    ],
  ],
};

export const memoryWriteAction: Action = {
  name: "SUPERAGENT_MEMORY_WRITE",
  similes: [
    "SUPERAGENT_SAVE_MEMORY",
    "SAVE_SUPERAGENT_MEMORY",
    "WRITE_SUPERAGENT_MEMORY",
  ],
  description:
    "Save one memory (fact, decision, preference, note) to managed memory. " +
    "Runs cloud-superbrain memory.create. Free for the first 200 memories, then 1 credit each. " +
    'Accepts {"text": "...", "memoryType": "note|fact|preference|decision", ' +
    '"tags": "a, b", "project": "..."} or plain text as the memory content.',
  validate: hasApiKey,
  handler: async (runtime, message, _state, _options, callback) =>
    runAction(runtime, message, callback, async (client, params) => {
      const text = asString(params.text) ?? message.content?.text ?? "";
      if (!text.trim()) {
        return { text: "Nothing to save: the memory text is empty." };
      }
      const input: Record<string, unknown> = {
        text,
        type: asString(params.memoryType) ?? "note",
      };
      const tags = parseTags(params.tags);
      if (tags) input.tags = tags;
      const project = asString(params.project);
      if (project) input.project = project;
      const result = await client.invoke(MEMORY_SERVICE_ID, {
        operationId: "memory.create",
        input,
      });
      return { text: truncate(result) };
    }),
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Remember that Pixel prefers concise briefs" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll save that to managed memory.",
          action: "SUPERAGENT_MEMORY_WRITE",
        },
      },
    ],
  ],
};

export const memoryReadAction: Action = {
  name: "SUPERAGENT_MEMORY_READ",
  similes: [
    "SUPERAGENT_RECALL_MEMORY",
    "SEARCH_SUPERAGENT_MEMORY",
    "READ_SUPERAGENT_MEMORY",
  ],
  description:
    "Search saved memories by meaning and keywords. Runs cloud-superbrain " +
    "memory.recall. Returns matching memories, not an answer. " +
    'Accepts {"query": "...", "tags": "a, b", "project": "...", "limit": 10} ' +
    "or plain text as the query. Limit is clamped to 1-50.",
  validate: hasApiKey,
  handler: async (runtime, message, _state, _options, callback) =>
    runAction(runtime, message, callback, async (client, params) => {
      const query = asString(params.query) ?? asString(params.text) ?? "";
      const limit = Math.max(1, Math.min(asInt(params.limit) ?? 10, 50));
      const input: Record<string, unknown> = { query, limit };
      const tags = parseTags(params.tags);
      if (tags) input.tags = tags;
      const project = asString(params.project);
      if (project) input.project = project;
      const result = await client.invoke(MEMORY_SERVICE_ID, {
        operationId: "memory.recall",
        input,
      });
      return { text: truncate(result) };
    }),
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "What do you remember about Pixel's preferences?" },
      },
      {
        name: "{{agentName}}",
        content: {
          text: "I'll search managed memory.",
          action: "SUPERAGENT_MEMORY_READ",
        },
      },
    ],
  ],
};

/** All seven SuperAgent actions, in a sensible discovery order. */
export const superAgentActions: Action[] = [
  listServicesAction,
  searchActionsAction,
  invokeServiceAction,
  getCreditBalanceAction,
  getPricingAction,
  memoryWriteAction,
  memoryReadAction,
];
