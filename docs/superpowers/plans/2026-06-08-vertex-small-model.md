# Vertex AI provider for `getSmallModel` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `getSmallModel()` produce a working small model from Google Vertex AI (Claude on Vertex) when the user is configured for Vertex, so workspace naming stops falling back to random two-word branch names for users with no Anthropic/OpenAI key.

**Architecture:** Add a flag-gated `resolveVertex()` branch to the single shared `getSmallModel()` resolver in `packages/chat`. A new `vertex-config.ts` reads Vertex env (`CLAUDE_CODE_USE_VERTEX`, `ANTHROPIC_VERTEX_PROJECT_ID`, `CLOUD_ML_REGION`) from `process.env`, falling back per-key to the persisted `chat-anthropic-env.json` blob (the Advanced "Additional env vars" settings field). `resolveVertex()` is called first; it returns `null` unless the flag is `1` and a project is set, so flag-off behavior is byte-for-byte identical to today. Fixes all five `getSmallModel` consumers at once since they share the one function. No new UI, no new tRPC router.

**Tech Stack:** Bun + bun:test, TypeScript, `@ai-sdk/google-vertex@3.0.127` (`createVertexAnthropic` on the `/anthropic` subpath), `@mastra/core` `MastraModelConfig`, existing `anthropic-env-config.ts` persistence.

**Spec:** `docs/superpowers/specs/2026-06-08-vertex-small-model-design.md`

---

## File Structure

- **Create** `packages/chat/src/server/shared/small-model/vertex-config.ts` — resolves `{ project, location } | null` from env + persisted file. One responsibility: turn configuration into a Vertex config or nothing.
- **Create** `packages/chat/src/server/shared/small-model/vertex-config.test.ts` — unit tests for the resolver.
- **Modify** `packages/chat/src/server/shared/small-model/get-small-model.ts` — add `VERTEX_SMALL_MODEL_ID`, `resolveVertex()`, and the first-position call in `getSmallModel()`.
- **Modify** `packages/chat/src/server/shared/small-model/get-small-model.test.ts` — add tests for `resolveVertex` + the vertex-first precedence.
- **Modify** `packages/chat/package.json` — add `@ai-sdk/google-vertex` dependency.

No caller changes: `apps/desktop/.../ai-name.ts`, `apps/desktop/.../ai-branch-name.ts`, `packages/host-service/.../ai-branch-name.ts`, and `packages/host-service/.../ai-workspace-names.ts` all consume `getSmallModel()` unchanged.

---

## Task 1: Add the `@ai-sdk/google-vertex` dependency

**Files:**
- Modify: `packages/chat/package.json`

- [ ] **Step 1: Add the dependency**

In `packages/chat/package.json`, add this entry to the `dependencies` object, keeping alphabetical order (it sorts before `@ai-sdk/openai`, after `@ai-sdk/anthropic`):

```json
		"@ai-sdk/google-vertex": "3.0.127",
```

- [ ] **Step 2: Install**

Run: `bun install`
Expected: completes without error; `@ai-sdk/google-vertex@3.0.127` is now a direct dependency of `packages/chat`. (It already resolves in `bun.lock` transitively, so no version churn.)

- [ ] **Step 3: Verify the subpath + export resolve**

Run:
```bash
cd packages/chat && bun -e "const m = require('@ai-sdk/google-vertex/anthropic'); console.log(typeof m.createVertexAnthropic)"
```
Expected output: `function`

- [ ] **Step 4: Commit**

```bash
git add packages/chat/package.json bun.lock
git commit -m "build(chat): add @ai-sdk/google-vertex for small-model Vertex support"
```

---

## Task 2: `vertex-config.ts` — resolve Vertex config from env + persisted file

**Files:**
- Create: `packages/chat/src/server/shared/small-model/vertex-config.ts`
- Test: `packages/chat/src/server/shared/small-model/vertex-config.test.ts`

`resolveVertexConfig()` returns `{ project, location }` only when Vertex is fully enabled (`CLAUDE_CODE_USE_VERTEX === "1"` and a non-empty project), else `null`. Each key is read from `process.env` first, then from the persisted `chat-anthropic-env.json` blob via the existing `getAnthropicEnvConfig()` reader (the Advanced "Additional env vars" settings field). The file fallback exists because that blob is only applied to `process.env` on the chat-runtime path, **not** the workspace-creation/naming path — reading it directly makes the existing settings field drive naming regardless of process or timing.

- [ ] **Step 1: Write the failing test**

Create `packages/chat/src/server/shared/small-model/vertex-config.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// Mutable store the mocked env-config reader returns, so each test controls
// the "persisted file" contents without touching disk.
let fileVariables: Record<string, string> = {};

mock.module(
	"../../desktop/chat-service/anthropic-env-config",
	() => ({
		getAnthropicEnvConfig: () => ({
			envText: "",
			variables: fileVariables,
		}),
	}),
);

// Imported after mock.module so the mock is in place.
const { resolveVertexConfig } = await import("./vertex-config");

const VERTEX_ENV_KEYS = [
	"CLAUDE_CODE_USE_VERTEX",
	"ANTHROPIC_VERTEX_PROJECT_ID",
	"CLOUD_ML_REGION",
] as const;

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
	fileVariables = {};
	savedEnv = {};
	for (const key of VERTEX_ENV_KEYS) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
});

afterEach(() => {
	for (const key of VERTEX_ENV_KEYS) {
		if (savedEnv[key] === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = savedEnv[key];
		}
	}
});

describe("resolveVertexConfig", () => {
	it("returns null when the flag is unset", () => {
		expect(resolveVertexConfig()).toBeNull();
	});

	it("returns null when the flag is set but no project is present", () => {
		process.env.CLAUDE_CODE_USE_VERTEX = "1";
		expect(resolveVertexConfig()).toBeNull();
	});

	it("returns config from process.env when fully enabled", () => {
		process.env.CLAUDE_CODE_USE_VERTEX = "1";
		process.env.ANTHROPIC_VERTEX_PROJECT_ID = "my-proj";
		process.env.CLOUD_ML_REGION = "us-east5";
		expect(resolveVertexConfig()).toEqual({
			project: "my-proj",
			location: "us-east5",
		});
	});

	it("defaults location to 'global' when CLOUD_ML_REGION is unset", () => {
		process.env.CLAUDE_CODE_USE_VERTEX = "1";
		process.env.ANTHROPIC_VERTEX_PROJECT_ID = "my-proj";
		expect(resolveVertexConfig()).toEqual({
			project: "my-proj",
			location: "global",
		});
	});

	it("falls back to the persisted file when an env key is absent", () => {
		fileVariables = {
			CLAUDE_CODE_USE_VERTEX: "1",
			ANTHROPIC_VERTEX_PROJECT_ID: "file-proj",
			CLOUD_ML_REGION: "europe-west1",
		};
		expect(resolveVertexConfig()).toEqual({
			project: "file-proj",
			location: "europe-west1",
		});
	});

	it("prefers process.env over the persisted file when both are present", () => {
		process.env.CLAUDE_CODE_USE_VERTEX = "1";
		process.env.ANTHROPIC_VERTEX_PROJECT_ID = "env-proj";
		fileVariables = {
			ANTHROPIC_VERTEX_PROJECT_ID: "file-proj",
			CLOUD_ML_REGION: "europe-west1",
		};
		expect(resolveVertexConfig()).toEqual({
			project: "env-proj",
			location: "europe-west1",
		});
	});

	it("treats a non-'1' flag value as disabled", () => {
		process.env.CLAUDE_CODE_USE_VERTEX = "true";
		process.env.ANTHROPIC_VERTEX_PROJECT_ID = "my-proj";
		expect(resolveVertexConfig()).toBeNull();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/chat && bun test src/server/shared/small-model/vertex-config.test.ts`
Expected: FAIL — cannot resolve module `./vertex-config` (file does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `packages/chat/src/server/shared/small-model/vertex-config.ts`:

```typescript
import { getAnthropicEnvConfig } from "../../desktop/chat-service/anthropic-env-config";

export interface VertexConfig {
	project: string;
	location: string;
}

/**
 * Reads the persisted Advanced "Additional env vars" blob
 * (`chat-anthropic-env.json`). Returns an empty map on any failure — the
 * file is optional and a parse error must never break naming.
 */
function readPersistedEnv(): Record<string, string> {
	try {
		return getAnthropicEnvConfig().variables;
	} catch {
		return {};
	}
}

/**
 * Resolves a single Vertex env value: `process.env` first, then the persisted
 * settings blob. Returns `undefined` when neither holds a non-empty value.
 */
function pickEnv(
	key: string,
	persisted: Record<string, string>,
): string | undefined {
	const fromProcess = process.env[key]?.trim();
	if (fromProcess) return fromProcess;
	const fromFile = persisted[key]?.trim();
	return fromFile ? fromFile : undefined;
}

/**
 * Returns Vertex config only when the user is fully configured for Claude on
 * Vertex: `CLAUDE_CODE_USE_VERTEX === "1"` and a non-empty project. Otherwise
 * `null`. `location` defaults to `"global"` (matching claude-code, which uses
 * the global endpoint when `CLOUD_ML_REGION` is unset).
 *
 * Each key is read from `process.env` first, falling back to the persisted
 * `chat-anthropic-env.json` blob so the existing settings field drives naming
 * even on process/timing paths where the blob is never applied to `process.env`.
 */
export function resolveVertexConfig(): VertexConfig | null {
	const persisted = readPersistedEnv();

	if (pickEnv("CLAUDE_CODE_USE_VERTEX", persisted) !== "1") return null;

	const project = pickEnv("ANTHROPIC_VERTEX_PROJECT_ID", persisted);
	if (!project) return null;

	const location = pickEnv("CLOUD_ML_REGION", persisted) ?? "global";
	return { project, location };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/chat && bun test src/server/shared/small-model/vertex-config.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/server/shared/small-model/vertex-config.ts packages/chat/src/server/shared/small-model/vertex-config.test.ts
git commit -m "feat(chat): resolve Vertex small-model config from env + settings blob"
```

---

## Task 3: Wire `resolveVertex()` into `getSmallModel()`

**Files:**
- Modify: `packages/chat/src/server/shared/small-model/get-small-model.ts`
- Test: `packages/chat/src/server/shared/small-model/get-small-model.test.ts`

`resolveVertex()` is exported (so it can be unit-tested without the mastracode auth-storage chain) and called first in `getSmallModel()`. It returns `null` unless `resolveVertexConfig()` yields a config; on any throw from provider init it warns and returns `null` so naming falls through to the existing resolvers. Vertex auth uses Application Default Credentials, auto-discovered by `google-auth-library` — no API key is passed.

The Vertex model id uses the `@`-date form (`claude-haiku-4-5@20251001`), unlike the Anthropic API `-date` form. `createVertexAnthropic(...)(id)` returns an AI-SDK `LanguageModelV2`, which satisfies `MastraModelConfig`.

- [ ] **Step 1: Write the failing tests**

Add these imports and blocks to `packages/chat/src/server/shared/small-model/get-small-model.test.ts`. Replace the existing top-of-file import line:

```typescript
import { describe, expect, it } from "bun:test";
import { isAnthropicApiKey, isOpenAIApiKey } from "./get-small-model";
```

with module mocks plus dynamic import (mocks must be registered before the module under test loads), keeping the existing `isAnthropicApiKey` / `isOpenAIApiKey` describe blocks below unchanged:

```typescript
import { afterEach, describe, expect, it, mock } from "bun:test";

// Controls what the Vertex config resolver returns per test.
let vertexConfig: { project: string; location: string } | null = null;
mock.module("./vertex-config", () => ({
	resolveVertexConfig: () => vertexConfig,
}));

// Sentinel model + a createVertexAnthropic that can be told to throw.
const VERTEX_MODEL_SENTINEL = { __vertexModel: true } as const;
let vertexShouldThrow = false;
mock.module("@ai-sdk/google-vertex/anthropic", () => ({
	createVertexAnthropic: () => {
		if (vertexShouldThrow) {
			throw new Error("vertex init boom");
		}
		return () => VERTEX_MODEL_SENTINEL;
	},
}));

const { getSmallModel, isAnthropicApiKey, isOpenAIApiKey, resolveVertex } =
	await import("./get-small-model");

afterEach(() => {
	vertexConfig = null;
	vertexShouldThrow = false;
});

describe("resolveVertex", () => {
	it("returns null when no Vertex config is resolved", () => {
		vertexConfig = null;
		expect(resolveVertex()).toBeNull();
	});

	it("returns a model when Vertex config is present", () => {
		vertexConfig = { project: "p", location: "global" };
		expect(resolveVertex()).toBe(VERTEX_MODEL_SENTINEL);
	});

	it("returns null (does not throw) when provider init fails", () => {
		vertexConfig = { project: "p", location: "global" };
		vertexShouldThrow = true;
		expect(resolveVertex()).toBeNull();
	});
});

describe("getSmallModel — Vertex precedence", () => {
	it("returns the Vertex model first when Vertex is enabled", async () => {
		vertexConfig = { project: "p", location: "global" };
		expect(await getSmallModel()).toBe(VERTEX_MODEL_SENTINEL);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/chat && bun test src/server/shared/small-model/get-small-model.test.ts`
Expected: FAIL — `resolveVertex` is not exported from `./get-small-model` (and the Vertex describe blocks error).

- [ ] **Step 3: Implement the wiring**

In `packages/chat/src/server/shared/small-model/get-small-model.ts`:

Add the import (after the existing `@ai-sdk/openai` import on line 2):

```typescript
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic";
```

Add the import for the config resolver (after the `auth-provider-ids` import block, ~line 8):

```typescript
import { resolveVertexConfig } from "./vertex-config";
```

Add the model-id constant next to the existing ones (after line 11, `OPENAI_SMALL_MODEL_ID`):

```typescript
// Vertex uses the `@`-date model id form, vs the Anthropic API `-date` form.
const VERTEX_SMALL_MODEL_ID = "claude-haiku-4-5@20251001";
```

Add the resolver (place it just above `getSmallModel`, after `resolveOpenAIApiKey`):

```typescript
/**
 * Resolves a Claude-on-Vertex small model when the user is configured for
 * Vertex (`CLAUDE_CODE_USE_VERTEX=1` + project). Returns `null` otherwise, so
 * behavior with the flag unset is identical to before. Auth uses Application
 * Default Credentials, auto-discovered by google-auth-library — no key passed.
 *
 * A misconfigured Vertex must not break naming: any init throw is logged and
 * we fall through to the Anthropic/OpenAI resolvers.
 */
export function resolveVertex(): MastraModelConfig | null {
	const config = resolveVertexConfig();
	if (!config) return null;

	try {
		return createVertexAnthropic({
			project: config.project,
			location: config.location,
		})(VERTEX_SMALL_MODEL_ID);
	} catch (error) {
		console.warn("[get-small-model] vertex resolution failed:", error);
		return null;
	}
}
```

Add the first-position call inside `getSmallModel`, immediately after the function opens (before `const anthropic = await resolveAnthropic();`):

```typescript
	const vertex = resolveVertex();
	if (vertex) return vertex;
```

Update the `getSmallModel` doc comment's resolution-order list to record the new first step (insert above the existing `1. ANTHROPIC_API_KEY` line and renumber):

```typescript
 * Resolution order:
 *   1. Vertex AI (Claude on Vertex) — when CLAUDE_CODE_USE_VERTEX=1 + project
 *   2. ANTHROPIC_API_KEY env var (validated)
 *   3. mastracode auth storage — Anthropic api key
 *   4. mastracode auth storage — Anthropic OAuth (refreshed on the fly)
 *   5. OPENAI_API_KEY env var (validated)
 *   6. mastracode auth storage — OpenAI api key (`openai-codex` / `openai`)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/chat && bun test src/server/shared/small-model/get-small-model.test.ts`
Expected: PASS — the 3 `resolveVertex` tests, the precedence test, and the existing validator tests all green.

- [ ] **Step 5: Commit**

```bash
git add packages/chat/src/server/shared/small-model/get-small-model.ts packages/chat/src/server/shared/small-model/get-small-model.test.ts
git commit -m "feat(chat): resolve Vertex small model first in getSmallModel"
```

---

## Task 4: Full-package verification (typecheck, lint, tests)

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the package**

Run: `bun run typecheck`
Expected: PASS with no errors. In particular, `createVertexAnthropic(...)(...)` (an `@ai-sdk/provider@2.0.1` `LanguageModelV2`) must be assignable to `MastraModelConfig` (which accepts `@ai-sdk/provider@2.0.3` `LanguageModelV2` — structurally identical at this patch range). If a structural mismatch is reported here, it is a real provider-version skew: append `as MastraModelConfig` to the `resolveVertex` return value with a comment noting the bundled-provider patch difference — the runtime object is a valid AI-SDK V2 model.

- [ ] **Step 2: Run the small-model tests together**

Run: `cd packages/chat && bun test src/server/shared/small-model/`
Expected: PASS — `vertex-config.test.ts` and `get-small-model.test.ts` all green.

- [ ] **Step 3: Lint (warnings fail CI)**

Run: `bun run lint`
Expected: exit 0, no output. If anything is reported, run `bun run lint:fix`, re-run `bun run lint` to confirm exit 0, then `git add -A && git commit -m "style: biome fixes"`.

- [ ] **Step 4: Final commit (if lint produced changes)**

Only if Step 3 produced fixes not already committed:

```bash
git add -A
git commit -m "style(chat): biome fixes for vertex small-model"
```

---

## Manual verification (post-implementation, real Vertex)

These confirm the spec's runtime risks against the actual environment; they are not automated steps.

1. **Model availability.** Confirm `claude-haiku-4-5@20251001` is enabled in the target Vertex project/region (`consolo-dev-vertex-wsky`, `us` / `global`). If not, pick an available Haiku model id and update `VERTEX_SMALL_MODEL_ID`.
2. **ADC reachability.** With `CLAUDE_CODE_USE_VERTEX=1`, `ANTHROPIC_VERTEX_PROJECT_ID` set, and ADC at `~/.config/gcloud/application_default_credentials.json`, create a v2 workspace with a descriptive prompt and confirm the workspace/branch name is AI-generated (not a random two-word fallback).
3. **Flag-off regression.** With `CLAUDE_CODE_USE_VERTEX` unset, confirm naming behavior is unchanged from before this change.
```
