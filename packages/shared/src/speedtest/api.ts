import { defineCommand, defineNotification } from "../ipc/protocol";

export interface SpeedtestInterval {
	start_time_seconds: number;
	end_time_seconds: number;
	throughput_mbits: number;
}

export interface SpeedtestResult {
	overall: SpeedtestInterval;
	intervals: SpeedtestInterval[];
}

export interface SpeedtestData {
	workspaceName: string;
	result: SpeedtestResult;
}

export const SpeedtestApi = {
	/** Extension pushes parsed results to the webview */
	data: defineNotification<SpeedtestData>("speedtest/data"),
	/** Webview requests to open raw JSON in a text editor */
	viewJson: defineCommand<void>("speedtest/viewJson"),
} as const;
