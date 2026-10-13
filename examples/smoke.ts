/**
 * Smoke test: run the plugin's actions against the real SuperAgent API.
 *
 * Read-only by default (list/search/balance/pricing). Requires the
 * HIVEMINDOS_API_KEY environment variable. Never prints the key.
 *
 * Usage: HIVEMINDOS_API_KEY=... npm run example
 */
import type { IAgentRuntime, Memory } from "@elizaos/core";
import {
  getCreditBalanceAction,
  listServicesAction,
  searchActionsAction,
  memoryReadAction,
} from "../src/index.js";

const runtime = {
  getSetting: (key: string) =>
    key === "HIVEMINDOS_API_KEY" ? process.env.HIVEMINDOS_API_KEY ?? null : null,
} as unknown as IAgentRuntime;

const message = (text: string): Memory =>
  ({ content: { text } }) as Memory;

async function main() {
  const apiKey = process.env.HIVEMINDOS_API_KEY;
  if (!apiKey) {
    console.error("Set HIVEMINDOS_API_KEY first.");
    process.exit(1);
  }

  for (const action of [
    listServicesAction,
    searchActionsAction,
    getCreditBalanceAction,
    memoryReadAction,
  ]) {
    const valid = await action.validate(runtime, message("ping"));
    console.log(`\n## ${action.name} (validate: ${valid})`);
    if (!valid) continue;
    const text =
      action === searchActionsAction
        ? '{"query": "memory", "limit": 3}'
        : action === memoryReadAction
          ? '{"query": "smoke test", "limit": 2}'
          : action === listServicesAction
            ? '{"nameFilter": "memory"}'
            : "ping";
    const result = await action.handler(
      runtime,
      message(text),
      undefined,
      undefined,
      undefined
    );
    console.log(`success: ${result?.success}`);
    console.log((result?.text ?? "").slice(0, 600));
  }
}

main().catch((error) => {
  console.error("smoke failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
