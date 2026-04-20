import { defineCommand, defineNotification } from "../ipc/protocol";

export interface SpeedtestData {
	json: string;
	workspaceName: string;
}

export const SpeedtestApi = {
	/** Extension pushes results to the webview */
	data: defineNotification<SpeedtestData>("speedtest/data"),
	/** Webview requests to open raw JSON in a text editor */
	viewJson: defineCommand<string>("speedtest/viewJson"),
} as const;
