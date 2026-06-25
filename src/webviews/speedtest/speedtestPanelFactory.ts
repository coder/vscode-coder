import {
	buildCommandHandlers,
	buildRequestHandlers,
	SpeedtestApi,
	type SpeedtestData,
	type SpeedtestResult,
} from "@repo/shared";

import { notifyWebview } from "../dispatch";
import { showResultPanel } from "../resultPanel";

import type * as vscode from "vscode";

import type { Logger } from "../../logging/logger";

export interface SpeedtestChartPayload {
	result: SpeedtestResult;
	rawJson: string;
	workspaceId: string;
}

/** Creates webview panels that render speedtest runs as interactive charts. */
export class SpeedtestPanelFactory {
	public constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly logger: Logger,
	) {}

	public show({ result, rawJson, workspaceId }: SpeedtestChartPayload): void {
		const payload: SpeedtestData = { workspaceId, result };
		showResultPanel({
			extensionUri: this.extensionUri,
			logger: this.logger,
			viewType: "coder.speedtestPanel",
			webviewName: "speedtest",
			title: `Speed Test: ${workspaceId}`,
			rawJson,
			jsonErrorLabel: "speed test",
			notify: (webview) => notifyWebview(webview, SpeedtestApi.data, payload),
			// Both builders emit a compile error if any command or request in the
			// API lacks a handler here; the empty `{}` below is still load-bearing.
			buildHandlers: ({ sendData, openRawJson }) => ({
				commands: buildCommandHandlers(SpeedtestApi, {
					// Webview signals it's subscribed; safe to push the payload now.
					ready: () => {
						sendData();
					},
					viewJson: () => openRawJson(),
				}),
				requests: buildRequestHandlers(SpeedtestApi, {}),
			}),
		});
	}
}
