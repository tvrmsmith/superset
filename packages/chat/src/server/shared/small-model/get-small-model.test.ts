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
