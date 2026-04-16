import prettyBytes from "pretty-bytes";
import * as vscode from "vscode";

import type { NetworkInfo } from "./sshProcess";

/** Number of consecutive polls required to trigger or clear a warning */
const WARNING_DEBOUNCE_THRESHOLD = 3;

const WARNING_BACKGROUND = new vscode.ThemeColor(
	"statusBarItem.warningBackground",
);

export interface NetworkThresholds {
	latencyMs: number;
}

function getThresholdConfig(): NetworkThresholds {
	const cfg = vscode.workspace.getConfiguration("coder");
	return {
		latencyMs: cfg.get<number>("networkThreshold.latencyMs", 200),
	};
}

export function isLatencySlow(
	network: NetworkInfo,
	thresholds: NetworkThresholds,
): boolean {
	return thresholds.latencyMs > 0 && network.latency > thresholds.latencyMs;
}

export function buildNetworkTooltip(
	network: NetworkInfo,
	latencySlow: boolean,
	thresholds: NetworkThresholds,
): vscode.MarkdownString {
	const fmt = (bytesPerSec: number) =>
		prettyBytes(bytesPerSec * 8, { bits: true }) + "/s";

	const sections: string[] = [];

	if (latencySlow) {
		sections.push("$(warning) **Slow connection detected**");
	}

	const metrics: string[] = [];
	metrics.push(
		latencySlow
			? `Latency: ${network.latency.toFixed(2)}ms (threshold: ${thresholds.latencyMs}ms)`
			: `Latency: ${network.latency.toFixed(2)}ms`,
	);
	metrics.push(`Download: ${fmt(network.download_bytes_sec)}`);
	metrics.push(`Upload: ${fmt(network.upload_bytes_sec)}`);

	if (network.using_coder_connect) {
		metrics.push("Connection: Coder Connect");
	} else if (network.p2p) {
		metrics.push("Connection: Direct (P2P)");
	} else {
		metrics.push(`Connection: ${network.preferred_derp} (relay)`);
	}

	// Two trailing spaces + \n = hard line break (tight rows within a section).
	sections.push(metrics.join("  \n"));

	if (latencySlow) {
		sections.push(
			"[$(pulse) Ping workspace](command:coder.pingWorkspace) · " +
				"[$(gear) Configure threshold](command:workbench.action.openSettings?%22coder.networkThreshold%22)",
		);
	}

	// Blank line between sections = paragraph break.
	const md = new vscode.MarkdownString(sections.join("\n\n"));
	md.isTrusted = true;
	md.supportThemeIcons = true;
	return md;
}

/**
 * Manages network status bar presentation and slowness warning state.
 * Owns the warning debounce logic and status bar updates.
 */
export class NetworkStatusReporter {
	private warningCounter = 0;
	private isWarningActive = false;

	constructor(private readonly statusBarItem: vscode.StatusBarItem) {}

	update(network: NetworkInfo, isStale: boolean): void {
		let statusText = "$(globe) ";

		// Coder Connect doesn't populate any other stats
		if (network.using_coder_connect) {
			this.warningCounter = 0;
			this.isWarningActive = false;
			this.statusBarItem.text = statusText + "Coder Connect ";
			this.statusBarItem.tooltip = "You're connected using Coder Connect.";
			this.statusBarItem.backgroundColor = undefined;
			this.statusBarItem.command = undefined;
			this.statusBarItem.show();
			return;
		}

		const thresholds = getThresholdConfig();
		const latencySlow = isLatencySlow(network, thresholds);
		this.updateWarningState(latencySlow);

		if (network.p2p) {
			statusText += "Direct ";
		} else {
			statusText += network.preferred_derp + " ";
		}

		const latencyText = isStale
			? `(~${network.latency.toFixed(2)}ms)`
			: `(${network.latency.toFixed(2)}ms)`;
		statusText += latencyText;
		this.statusBarItem.text = statusText;

		if (this.isWarningActive) {
			this.statusBarItem.backgroundColor = WARNING_BACKGROUND;
			this.statusBarItem.command = "coder.pingWorkspace";
		} else {
			this.statusBarItem.backgroundColor = undefined;
			this.statusBarItem.command = undefined;
		}

		this.statusBarItem.tooltip = buildNetworkTooltip(
			network,
			this.isWarningActive,
			thresholds,
		);

		this.statusBarItem.show();
	}

	private updateWarningState(latencySlow: boolean): void {
		if (latencySlow) {
			this.warningCounter = Math.min(
				this.warningCounter + 1,
				WARNING_DEBOUNCE_THRESHOLD,
			);
		} else {
			this.warningCounter = Math.max(this.warningCounter - 1, 0);
		}

		if (this.warningCounter >= WARNING_DEBOUNCE_THRESHOLD) {
			this.isWarningActive = true;
		} else if (this.warningCounter === 0) {
			this.isWarningActive = false;
		}
	}
}
