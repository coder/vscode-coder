// IPC protocol types
export * from "./ipc/protocol";

// Error utilities
export { toError } from "./error/utils";

// Tasks types, utilities, and API
export * from "./tasks/types";
export * from "./tasks/utils";
export * from "./tasks/api";

// Speedtest API
export {
	SpeedtestApi,
	type SpeedtestData,
	type SpeedtestInterval,
	type SpeedtestResult,
} from "./speedtest/api";

// Netcheck API
export {
	NetcheckApi,
	overallNetcheckSeverity,
	type NetcheckConnectivity,
	type NetcheckData,
	type NetcheckHealthMessage,
	type NetcheckInterface,
	type NetcheckNodeReport,
	type NetcheckRegionReport,
	type NetcheckReport,
	type NetcheckSectionHealth,
	type NetcheckSeverity,
} from "./netcheck/api";

// Workspaces API
export { WorkspacesApi } from "./workspaces/api";
