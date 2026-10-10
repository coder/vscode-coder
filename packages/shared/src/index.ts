// IPC protocol types
export * from "./ipc/protocol";

// Error utilities
export { toError } from "./error/toError";

// Tasks types, utilities, and API
export * from "./tasks/types";
export * from "./tasks/status";
export * from "./tasks/api";

// Speedtest API
export {
	SpeedtestApi,
	type SpeedtestData,
	type SpeedtestInterval,
	type SpeedtestResult,
} from "./speedtest/api";

// Netcheck API
export { NetcheckApi } from "./netcheck/api";
export { overallNetcheckSeverity, worstSeverity } from "./netcheck/severity";
export type {
	NetcheckConnectivity,
	NetcheckData,
	NetcheckInterface,
	NetcheckRegionReport,
	NetcheckReport,
	NetcheckSectionHealth,
	NetcheckSeverity,
} from "./netcheck/types";

// Workspaces types and API
export * from "./workspaces/types";
export { WorkspacesApi } from "./workspaces/api";

export * from "./workspaceUpdate/api";
