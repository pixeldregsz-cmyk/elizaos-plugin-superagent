# @hivepunk21/elizaos-plugin-superagent

An [ElizaOS](https://github.com/elizaOS/eliza) plugin that gives agents the
**HivemindOS SuperAgent API** — 40 managed services / 408 operations (models,
memory, wallets, trading, media, automations, nft-agents), managed memory,
credit balance, and pricing, exposed as seven ElizaOS actions.

Built for the HivemindOS **"ElizaOS plugin" bounty** (25,000 credits):
*"Publish an ElizaOS plugin that gives agents the SuperAgent API, merged into
the plugin registry."*

- SuperAgent docs: https://hivemindos.app/superagent-api/docs/
- OpenAPI: https://api.hivemindos.app/openapi.json
- Bounty board: https://api.hivemindos.app/v1/hall/bounties

## Install

```bash
npm install @hivepunk21/elizaos-plugin-superagent
```

Register it in your ElizaOS agent (character config or project):

```jsonc
{
  "name": "SuperAgentBee",
  "plugins": ["@hivepunk21/elizaos-plugin-superagent"],
  "settings": {
    "HIVEMINDOS_API_KEY": "${HIVEMINDOS_API_KEY}"
  }
}
```

A full example character file lives at [`examples/character.json`](examples/character.json).

> The runtime auto-discovers any npm package whose `keywords` include
> `elizaos` — this package ships those keywords, so no extra wiring is needed.

## Configuration

| Setting | Required | Description |
|---|---|---|
| `HIVEMINDOS_API_KEY` | **Yes** | SuperAgent API key (console → API keys). Read from runtime settings first, then `process.env`. Never commit it. |
| `HIVEMINDOS_BASE_URL` | No | Override the API base URL (default `https://api.hivemindos.app/v1`). |
| `HIVEMINDOS_APP_ID` | No | Hall app id, sent as `X-HivemindOS-App`. |
| `HIVEMINDOS_PROJECT_ID` | No | Project selector for account-level keys, sent as `X-HivemindOS-Project`. |

Actions validate themselves: an action is only offered to the agent when a key
resolves. Handlers return a failed `ActionResult` (never throw) when the key is
missing or the API errors.

## Actions

| Action | What it does |
|---|---|
| `SUPERAGENT_LIST_SERVICES` | List managed services the key can use. Optional name filter. Start here. |
| `SUPERAGENT_SEARCH_ACTIONS` | Search the 400+ invokable actions. Find the exact `operationId` before invoking. |
| `SUPERAGENT_INVOKE_SERVICE` | Invoke any service operation — the workhorse. Mutations auto-get a unique `Idempotency-Key`. Paid calls spend credits. |
| `SUPERAGENT_GET_CREDIT_BALANCE` | Read the account credit balance. Check before paid work. |
| `SUPERAGENT_GET_PRICING` | Read server-owned service pricing. |
| `SUPERAGENT_MEMORY_WRITE` | Save a memory via `cloud-superbrain` `memory.create`. |
| `SUPERAGENT_MEMORY_READ` | Recall memories via `cloud-superbrain` `memory.recall` (limit clamped 1–50). |

### Passing parameters

ElizaOS handlers receive the agent's message, not a structured argument
object. Handlers here accept two forms:

1. **JSON payload** (preferred for invoke/memory), e.g.
   `{"serviceId": "cloud-superbrain", "operationId": "memory.create", "input": {"text": "Pixel prefers concise briefs"}}`
2. **Plain text**, mapped to the action's primary parameter (`query` / `text` / name filter).

Each action documents its JSON fields in its `description`, with usage
`examples` for the model.

## API notes (verified against the live API)

- **Auth:** Bearer API key. Every mutation carries a unique `Idempotency-Key`
  header (`^[A-Za-z0-9:._-]+$`); reusing a key with different input is rejected
  server-side. The client generates one per call unless you pass your own.
- **Cloudflare:** `api.hivemindos.app` blocks default non-browser HTTP clients
  (HTTP 403, error code 1010). The client sends a browser-like `User-Agent`.
- **Memory:** there are no standalone memory REST endpoints — memory lives in
  the `cloud-superbrain` managed service and is invoked through the standard
  `/services/{id}/invoke` path (`memory.create` / `memory.recall`).
- **Credits:** spending operations are refused when the balance can't cover
  them. `SUPERAGENT_GET_CREDIT_BALANCE` exists for exactly this check.

## Development

```bash
npm install
npm test        # vitest, fully mocked — no network, no credits
npm run build   # tsc → dist/
```

Smoke test against the live API (read-only calls only):

```bash
HIVEMINDOS_API_KEY=... npm run example
```

## Registry merge checklist

Per the ElizaOS registry (`elizaos/eliza` → `packages/registry/README.md`,
"Adding a third-party plugin"):

1. Create a GitHub account + repo for this package.
2. `npm publish --access public` (the `@hivepunk21` scope is fine — only
   `@elizaos/*` is reserved and rejected by the registry validator).
3. Tag a release (`v0.1.0`).
4. From the plugin project, run `elizaos plugins submit . --dry-run` to
   generate the entry metadata (a matching [`registry-entry.json`](registry-entry.json)
   is committed here as a starting point).
5. Fork `elizaos/eliza`, add the entry under
   `packages/registry/entries/third-party/`, run `validate` + `generate`,
   and open a PR with the entry file and regenerated
   `generated-registry.json`. Community entries are reviewed for security,
   functionality, and documentation quality before merge.
6. File the bounty claim on the HivemindOS Hall Rewards page
   (`/superagent-api/rewards/`) with the npm + registry links.

## License

MIT — see [LICENSE](LICENSE).
