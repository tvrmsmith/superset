import type { AnthropicEnvVariables } from "../../desktop/chat-service/anthropic-env-config";
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
function readPersistedEnv(): AnthropicEnvVariables {
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
	persisted: AnthropicEnvVariables,
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
