import {
	buildCommandHandlers,
	buildRequestHandlers,
	NetcheckApi,
	type NetcheckData,
	type NetcheckReport,
} from "@repo/shared";

import { notifyWebview } from "../dispatch";
import { showResultPanel } from "../resultPanel";

import type * as vscode from "vscode";

import type { Logger } from "../../logging/logger";

export interface NetcheckReportPayload {
	report: NetcheckReport;
	rawJson: string;
	host: string;
}

/** Creates webview panels that render `coder netcheck` reports. */
export class NetcheckPanelFactory {
	public constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly logger: Logger,
	) {}

	public show({ report, rawJson, host }: NetcheckReportPayload): void {
		const payload: NetcheckData = { host, report };
		showResultPanel({
			extensionUri: this.extensionUri,
			logger: this.logger,
			viewType: "coder.netcheckPanel",
			webviewName: "netcheck",
			title: `Network Check: ${host}`,
			rawJson,
			jsonErrorLabel: "network check",
			notify: (webview) => notifyWebview(webview, NetcheckApi.data, payload),
			// Both builders emit a compile error if any command or request in the
			// API lacks a handler here; the empty `{}` below is still load-bearing.
			buildHandlers: ({ sendData, openRawJson }) => ({
				commands: buildCommandHandlers(NetcheckApi, {
					// Webview signals it's subscribed; safe to push the payload now.
					ready: () => {
						sendData();
					},
					viewJson: () => openRawJson(),
				}),
				requests: buildRequestHandlers(NetcheckApi, {}),
			}),
		});
	}
}
