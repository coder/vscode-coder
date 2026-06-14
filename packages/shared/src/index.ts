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
export { NetcheckApi } from "./netcheck/api";
export { overallNetcheckSeverity } from "./netcheck/utils";
export type {
	NetcheckConnectivity,
	NetcheckData,
	NetcheckInterface,
	NetcheckRegionReport,
	NetcheckReport,
	NetcheckSectionHealth,
	NetcheckSeverity,
} from "./netcheck/types";

// Workspaces API
export { WorkspacesApi } from "./workspaces/api";
