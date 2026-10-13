/**
 * @hivepunk21/elizaos-plugin-superagent
 *
 * ElizaOS plugin that gives agents the HivemindOS SuperAgent API:
 * 40 managed services / 408 operations, managed memory, credits and pricing.
 */

import type { Plugin } from "@elizaos/core";
import {
  getCreditBalanceAction,
  getPricingAction,
  invokeServiceAction,
  listServicesAction,
  memoryReadAction,
  memoryWriteAction,
  searchActionsAction,
  superAgentActions,
} from "./actions.js";
import { SuperAgentAPIError, SuperAgentClient } from "./client.js";

export const superAgentPlugin: Plugin = {
  name: "superagent",
  description:
    "HivemindOS SuperAgent API — 40 managed services (models, memory, wallets, " +
    "trading, media, automations, nft-agents), managed memory, credit balance " +
    "and pricing as ElizaOS actions. Requires HIVEMINDOS_API_KEY.",
  actions: superAgentActions,
  // No providers/evaluators/services in v0.1.0 — actions only.
};

export default superAgentPlugin;

// Re-export the building blocks for consumers and tests.
export {
  superAgentActions,
  listServicesAction,
  searchActionsAction,
  invokeServiceAction,
  getCreditBalanceAction,
  getPricingAction,
  memoryWriteAction,
  memoryReadAction,
};
export { SuperAgentClient, SuperAgentAPIError };
export { MEMORY_SERVICE_ID, extractParams } from "./actions.js";
export {
  DEFAULT_BASE_URL,
  BROWSER_USER_AGENT,
} from "./client.js";
