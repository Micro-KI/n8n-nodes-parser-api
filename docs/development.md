# Development and releases

## Requirements

- Node.js 22.22.2 or newer, or 24.15 or newer (required by the release tooling)
- npm 11
- Docker or Podman for `npm run dev`

## Setup

```bash
git clone https://github.com/Micro-KI/n8n-nodes-parser-api.git
cd n8n-nodes-parser-api
npm ci
```

## Commands

| Command             | What it does                                                                  |
| ------------------- | ----------------------------------------------------------------------------- |
| `npm run build`     | Compiles TypeScript to `dist/` and copies the icons                           |
| `npm run lint`      | n8n community node rules, including the n8n Cloud checks                      |
| `npm run lint:fix`  | Fixes what lint can fix                                                       |
| `npm test`          | Builds and runs the unit tests in `test/api.test.mjs`. No network             |
| `npm run test:live` | Builds and calls the live API with the public test key. No secret, no credits |
| `npm run dev`       | Starts a local n8n with this node loaded                                      |

To load the node into an n8n that is already running, use `npx n8n-node dev --external-n8n`.

## Project layout

```text
credentials/ParserApiKiApi.credentials.ts   API key, fixed host, credential test
nodes/ParserApiKi/ParserApiKi.node.ts       Node description and execution
nodes/ParserApiKi/api.ts                    Pure helpers: retry rules, idempotency key, multipart body
nodes/ParserApiKi/ParserApiKi.node.json     Codex: categories and documentation links
test/api.test.mjs                           Unit tests for api.ts
test/live.test.mjs                          Contract tests against the live API
docs/                                       This documentation
```

`api.ts` has no n8n imports, so its tests run on the compiled file without an n8n instance.

## Rules for changes

- **Stable names.** Do not rename the package, the credential type `parserApiKiApi`, the node `parserApiKi`, or any parameter `name`. Saved credentials and workflows depend on them. Display names may change.
- **No runtime dependencies.** n8n Cloud rejects them. HTTP goes through `httpRequestWithAuthentication`, files through `getBinaryDataBuffer`.
- **Fixed host.** The credential only sends the key to `https://parser-api.micro-ki.de`. Do not add a URL field.
- **Keep the lock.** `restrictToSupportedNodes = true` stays in the credential. Without it, the generic HTTP Request node can select the key. `npm test` fails when the compiled credential is missing it, so a release cannot ship unlocked.
- **English only** in the node UI, error messages, README, and these docs.
- **Pass the JSON through.** Do not reshape API responses in the node.
- A breaking change to parameters needs a new node version (`version: [1, 2]`), not an edit of version 1.

## Local testing in n8n

`npx n8n-node dev --external-n8n` loads the node from `~/.n8n/custom`. That loader drops the credential's list of supported nodes, so with the lock in place n8n refuses to save the workflow ("restricted to: (no nodes)").

For local testing, remove the line `restrictToSupportedNodes = true as const;` from `credentials/ParserApiKiApi.credentials.ts`, run `npm run build`, and restart n8n. The key still only goes to `https://parser-api.micro-ki.de`, because `authenticate()` rejects every other host.

Put the line back before a release. `npm test` reads the compiled credential and fails while it is missing. A workflow saved without the lock uses the node type `CUSTOM.parserApiKi`. The published package uses `n8n-nodes-parser-api.parserApiKi`, so that saved workflow does not match it.

## Manual checks before a release

Run in a local n8n with the test key and with a live key:

1. Credential test passes with both keys and fails with a wrong key.
2. Parse Document for all six document types.
3. Get Quote, Get Account Balance, Get Recent Usage with and without a filter.
4. A `422` with **Continue**: a Switch on `error.detected_type` works.
5. Two runs with the same custom idempotency key and different files answer `409 idempotency_key_conflict`.
6. **Remove the File Afterwards** on and off.

## Releases

Releases are published from GitHub Actions with npm provenance, as n8n requires for verification.

1. Update `CHANGELOG.md`.
2. Run `npm run release` locally. It lints, builds, bumps the version, commits, tags (for example `1.0.1`), and pushes.
3. The tag starts `.github/workflows/publish.yml`, which runs the tests and publishes to npm.

### One-time setup

npm offers Trusted Publishing only for a package that already exists. The first version is therefore published once by hand:

1. Build and publish `1.0.0` from a clean checkout with `npm publish --access public` (two-factor authentication required).
2. On npmjs.com, open the package settings → **Trusted Publisher** → GitHub Actions: owner `Micro-KI`, repository `n8n-nodes-parser-api`, workflow `publish.yml`.
3. Publish the next version through the workflow. A trusted publisher that is not used within a few days may expire.

Version numbers `0.1.1` to `0.1.20` were used by an earlier, unpublished package with this name and cannot be published again.

### n8n verification

After a version with provenance is on npm, check it with:

```bash
npx @n8n/scan-community-package n8n-nodes-parser-api
```

Then submit the npm package URL in the [n8n Creator Portal](https://creators.n8n.io/). The portal checks the package and asks for a short video: install the package in n8n, set up the credential with the test key, run an operation, and show the result. Review can take up to four weeks.
