import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// Sentinel model + a createVertexAnthropic that can be told to throw.
// Mock ONLY the provider — do NOT mock ./vertex-config (that module is the
// subject of vertex-config.test.ts, and a process-global module mock would
// leak across files and break it). Drive the real resolveVertexConfig via env.
const VERTEX_MODEL_SENTINEL = { __vertexModel: true } as const;
let vertexShouldThrow = false;
let vertexBuildCount = 0;
mock.module("@ai-sdk/google-vertex/anthropic", () => ({
	createVertexAnthropic: () => {
		vertexBuildCount++;
		if (vertexShouldThrow) {
			throw new Error("vertex init boom");
		}
		return () => VERTEX_MODEL_SENTINEL;
	},
}));

const {
	getSmallModel,
	isAnthropicApiKey,
	isOpenAIApiKey,
	resolveVertex,
	__resetVertexCacheForTests,
} = await import("./get-small-model");

const VERTEX_ENV_KEYS = [
	"CLAUDE_CODE_USE_VERTEX",
	"ANTHROPIC_VERTEX_PROJECT_ID",
	"CLOUD_ML_REGION",
	"SUPERSET_HOME_DIR",
] as const;

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
	vertexShouldThrow = false;
	vertexBuildCount = 0;
	__resetVertexCacheForTests();
	savedEnv = {};
	for (const key of VERTEX_ENV_KEYS) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
	// Point the persisted-blob reader at a dir with no chat-anthropic-env.json
	// so the file fallback never interferes with these env-driven tests.
	process.env.SUPERSET_HOME_DIR = "/nonexistent-superset-test-home-dir";
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

function enableVertex() {
	process.env.CLAUDE_CODE_USE_VERTEX = "1";
	process.env.ANTHROPIC_VERTEX_PROJECT_ID = "p";
}

describe("resolveVertex", () => {
	it("returns null when no Vertex config is resolved", () => {
		expect(resolveVertex()).toBeNull();
	});

	it("returns a model when Vertex config is present", () => {
		enableVertex();
		expect(resolveVertex()).toBe(VERTEX_MODEL_SENTINEL);
	});

	it("returns null (does not throw) when provider init fails", () => {
		enableVertex();
		vertexShouldThrow = true;
		expect(resolveVertex()).toBeNull();
	});

	it("memoizes the provider across calls (builds auth client once)", () => {
		enableVertex();
		expect(resolveVertex()).toBe(VERTEX_MODEL_SENTINEL);
		expect(resolveVertex()).toBe(VERTEX_MODEL_SENTINEL);
		expect(vertexBuildCount).toBe(1);
	});

	it("rebuilds when project|location changes", () => {
		enableVertex();
		resolveVertex();
		process.env.CLOUD_ML_REGION = "us-east5";
		resolveVertex();
		expect(vertexBuildCount).toBe(2);
	});
});

describe("getSmallModel — Vertex precedence", () => {
	it("returns the Vertex model first when Vertex is enabled", async () => {
		enableVertex();
		expect(await getSmallModel()).toBe(VERTEX_MODEL_SENTINEL);
	});
});

describe("isAnthropicApiKey", () => {
	it("accepts a real-shaped key", () => {
		expect(
			isAnthropicApiKey(
				"sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			),
		).toBe(true);
	});

	it("rejects dev placeholders", () => {
		expect(isAnthropicApiKey("dummy")).toBe(false);
		expect(isAnthropicApiKey("placeholder")).toBe(false);
		expect(isAnthropicApiKey("")).toBe(false);
	});

	it("rejects OAuth access tokens (sk-ant-oat…) sent as api keys", () => {
		// OAuth tokens fail when sent via x-api-key. Filter them so we fall
		// through to the OAuth path which sends them via Authorization Bearer.
		expect(
			isAnthropicApiKey("sk-ant-oat-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
		).toBe(false);
	});

	it("rejects keys with the prefix but absurd lengths", () => {
		expect(isAnthropicApiKey("sk-ant-api")).toBe(false);
	});

	it("rejects unrelated provider keys", () => {
		expect(isAnthropicApiKey("sk-proj-foo")).toBe(false);
	});
});

describe("isOpenAIApiKey", () => {
	it("accepts legacy, project, and service-account key shapes", () => {
		expect(
			isOpenAIApiKey("sk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
		).toBe(true);
		expect(
			isOpenAIApiKey("sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
		).toBe(true);
		expect(
			isOpenAIApiKey("sk-svcacct-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
		).toBe(true);
	});

	it("rejects dev placeholders and obviously-fake values", () => {
		expect(isOpenAIApiKey("dummy")).toBe(false);
		expect(isOpenAIApiKey("sk-")).toBe(false);
		expect(isOpenAIApiKey("")).toBe(false);
	});

	it("rejects values without the sk- prefix", () => {
		expect(isOpenAIApiKey("api-key-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
	});
});
