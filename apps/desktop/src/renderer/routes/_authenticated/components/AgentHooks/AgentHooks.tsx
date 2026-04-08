import { useAgentHookListener } from "renderer/stores/tabs/useAgentHookListener";
import { useCommandWatcher } from "./hooks/useCommandWatcher";
import { useDevicePresence } from "./hooks/useDevicePresence";

/**
 * Component that runs agent-related hooks requiring CollectionsProvider context.
 * useCommandWatcher and useAgentHookListener use useCollections which must be inside the provider.
 */
export function AgentHooks() {
	useDevicePresence();
	useCommandWatcher();
	useAgentHookListener();
	return null;
}
