import { useAgentHookListener } from "renderer/stores/tabs/useAgentHookListener";
import { useCommandWatcher } from "./hooks/useCommandWatcher";
import { useDevicePresence } from "./hooks/useDevicePresence";

/** Must be rendered inside CollectionsProvider — child hooks depend on useCollections. */
export function AgentHooks() {
	useDevicePresence();
	useCommandWatcher();
	useAgentHookListener();
	return null;
}
