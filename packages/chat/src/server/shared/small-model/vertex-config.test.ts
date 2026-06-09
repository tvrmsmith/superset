import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// Mutable store the mocked env-config reader returns, so each test controls
// the "persisted file" contents without touching disk.
let fileVariables: Record<string, string> = {};

mock.module("../../desktop/chat-service/anthropic-env-config", () => ({
	getAnthropicEnvConfig: () => ({
		envText: "",
		variables: fileVariables,
	}),
}));

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

	it("returns null when project ID is whitespace only", () => {
		process.env.CLAUDE_CODE_USE_VERTEX = "1";
		process.env.ANTHROPIC_VERTEX_PROJECT_ID = "   ";
		expect(resolveVertexConfig()).toBeNull();
	});
});
