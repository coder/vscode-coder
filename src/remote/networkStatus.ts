import prettyBytes from "pretty-bytes";
import * as vscode from "vscode";

import type { NetworkInfo } from "./sshProcess";

/** Number of consecutive polls required to trigger or clear a warning */
const WARNING_DEBOUNCE_THRESHOLD = 2;

const WARNING_BACKGROUND = new vscode.ThemeColor(
	"statusBarItem.warningBackground",
);

const CODER_CONNECT_TEXT = "$(globe) Coder Connect";
const CODER_CONNECT_TOOLTIP = markdown(
	"$(cloud) Connected using Coder Connect. Detailed network stats aren't collected for this connection type.",
);

interface NetworkThresholds {
	latencyMs: number;
}

function connectionSummary(network: NetworkInfo): string {
	if (network.p2p) {
		return "$(zap) Directly connected peer-to-peer.";
	}
	return `$(broadcast) Connected via ${network.preferred_derp} relay. Will switch to peer-to-peer when available.`;
}

function buildStatusText(network: NetworkInfo, isStale: boolean): string {
	const label = network.p2p ? "Direct" : network.preferred_derp;
	const staleMarker = isStale ? "~" : "";
	return `$(globe) ${label} (${staleMarker}${network.latency.toFixed(2)}ms)`;
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
		// Coder Connect doesn't populate latency/throughput, so we show a dedicated
		// message and skip the slowness machinery entirely.
		if (network.using_coder_connect) {
			this.warningCounter = 0;
			this.isWarningActive = false;
			this.statusBarItem.text = CODER_CONNECT_TEXT;
			this.statusBarItem.tooltip = CODER_CONNECT_TOOLTIP;
			this.statusBarItem.backgroundColor = undefined;
			this.statusBarItem.command = undefined;
			this.statusBarItem.show();
			return;
		}

		const thresholds: NetworkThresholds = {
			latencyMs: vscode.workspace
				.getConfiguration("coder")
				.get<number>("networkThreshold.latencyMs", 250),
		};
		const isSlow =
			thresholds.latencyMs > 0 && network.latency > thresholds.latencyMs;
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
		const fmt = (bytesPerSec: number) =>
			prettyBytes(bytesPerSec * 8, { bits: true }) + "/s";

		const sections: string[] = [];
		if (this.isWarningActive) {
			sections.push("$(warning) **Slow connection detected**");
		}
		sections.push(connectionSummary(network));

		const thresholdSuffix =
			thresholds.latencyMs > 0 ? ` (threshold: ${thresholds.latencyMs}ms)` : "";
		const metrics = [
			`Latency: ${network.latency.toFixed(2)}ms${thresholdSuffix}`,
			`Download: ${fmt(network.download_bytes_sec)}`,
			`Upload: ${fmt(network.upload_bytes_sec)}`,
		];
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
