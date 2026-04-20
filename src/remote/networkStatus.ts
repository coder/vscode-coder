import prettyBytes from "pretty-bytes";
import * as vscode from "vscode";

import type { NetworkInfo } from "./sshProcess";

/** Number of consecutive polls required to trigger or clear a warning */
const WARNING_DEBOUNCE_THRESHOLD = 2;

const WARNING_BACKGROUND = new vscode.ThemeColor(
	"statusBarItem.warningBackground",
);

interface NetworkThresholds {
	latencyMs: number;
}

function connectionLabel(network: NetworkInfo): string {
	if (network.using_coder_connect) {
		return "Coder Connect";
	}
	if (network.p2p) {
		return "Direct";
	}
	return network.preferred_derp;
}

function connectionSummary(network: NetworkInfo): string {
	if (network.p2p) {
		return "$(zap) Directly connected peer-to-peer.";
	}
	return `$(broadcast) Connected via ${network.preferred_derp} relay. Will switch to peer-to-peer when available.`;
}

function formatLatency(latency: number, isStale: boolean): string | undefined {
	if (latency <= 0) {
		return undefined;
	}
	return isStale ? `(~${latency.toFixed(2)}ms)` : `(${latency.toFixed(2)}ms)`;
}

function buildStatusText(network: NetworkInfo, isStale: boolean): string {
	const parts = ["$(globe)", connectionLabel(network)];
	const latency = formatLatency(network.latency, isStale);
	if (latency) {
		parts.push(latency);
	}
	return parts.join(" ");
}

/**
 * Manages network status bar presentation.
 * Warning state is debounced over consecutive polls to avoid flicker.
 */
export class NetworkStatusReporter {
	private warningCounter = 0;
	private isWarningActive = false;

	constructor(private readonly statusBarItem: vscode.StatusBarItem) {}

	update(network: NetworkInfo, isStale: boolean): void {
		const thresholds: NetworkThresholds = {
			latencyMs: vscode.workspace
				.getConfiguration("coder")
				.get<number>("networkThreshold.latencyMs", 250),
		};
		const isSlow =
			!network.using_coder_connect &&
			thresholds.latencyMs > 0 &&
			network.latency > thresholds.latencyMs;
		this.updateWarningState(isSlow);

		this.statusBarItem.text = buildStatusText(network, isStale);
		this.statusBarItem.tooltip = this.buildTooltip(
			network,
			thresholds,
			isStale,
		);
		this.statusBarItem.backgroundColor = this.isWarningActive
			? WARNING_BACKGROUND
			: undefined;
		this.statusBarItem.command = this.isWarningActive
			? "coder.pingWorkspace"
			: undefined;
		this.statusBarItem.show();
	}

	private updateWarningState(isSlow: boolean): void {
		if (isSlow) {
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

	private buildTooltip(
		network: NetworkInfo,
		thresholds: NetworkThresholds,
		isStale: boolean,
	): vscode.MarkdownString {
		// The Coder CLI only populates `using_coder_connect: true` for this path
		// and leaves latency/throughput at zero, so we show a dedicated message
		// instead of rendering empty metric lines.
		if (network.using_coder_connect) {
			return markdown(
				"$(cloud) Connected using Coder Connect. Detailed network stats aren't collected for this connection type.",
			);
		}

		const fmt = (bytesPerSec: number) =>
			prettyBytes(bytesPerSec * 8, { bits: true }) + "/s";

		const sections: string[] = [];
		if (this.isWarningActive) {
			sections.push("$(warning) **Slow connection detected**");
		}
		sections.push(connectionSummary(network));

		const metrics: string[] = [];
		if (network.latency > 0) {
			metrics.push(
				thresholds.latencyMs > 0
					? `Latency: ${network.latency.toFixed(2)}ms (threshold: ${thresholds.latencyMs}ms)`
					: `Latency: ${network.latency.toFixed(2)}ms`,
			);
		}
		metrics.push(`Download: ${fmt(network.download_bytes_sec)}`);
		metrics.push(`Upload: ${fmt(network.upload_bytes_sec)}`);
		// Two trailing spaces + \n = hard line break (tight rows within a section).
		sections.push(metrics.join("  \n"));

		if (this.isWarningActive) {
			sections.push(
				"[$(pulse) Run latency test](command:coder.pingWorkspace) · " +
					"[$(gear) Configure threshold](command:workbench.action.openSettings?%22coder.networkThreshold%22)",
			);
		}

		if (isStale) {
			sections.push(
				"$(history) Readings are stale; waiting for a fresh sample.",
			);
		}

		// Blank line between sections = paragraph break.
		return markdown(sections.join("\n\n"));
	}
}

function markdown(value: string): vscode.MarkdownString {
	const md = new vscode.MarkdownString(value);
	md.isTrusted = true;
	md.supportThemeIcons = true;
	return md;
}
