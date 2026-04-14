import prettyBytes from "pretty-bytes";
import * as vscode from "vscode";

import type { NetworkInfo } from "./sshProcess";

/** Bytes per second in 1 Mbps */
const BYTES_PER_MBPS = 125_000;

/** Number of consecutive polls required to trigger or clear a warning */
const WARNING_DEBOUNCE_THRESHOLD = 3;

export interface ThresholdViolations {
	latency: boolean;
	download: boolean;
	upload: boolean;
}

const NO_VIOLATIONS: ThresholdViolations = {
	latency: false,
	download: false,
	upload: false,
};

export function getThresholdConfig(): {
	latencyMs: number;
	downloadMbps: number;
	uploadMbps: number;
} {
	const cfg = vscode.workspace.getConfiguration("coder");
	return {
		latencyMs: cfg.get<number>("networkThreshold.latencyMs", 200),
		downloadMbps: cfg.get<number>("networkThreshold.downloadMbps", 5),
		uploadMbps: cfg.get<number>("networkThreshold.uploadMbps", 0),
	};
}

export function checkThresholdViolations(
	network: NetworkInfo,
	thresholds: { latencyMs: number; downloadMbps: number; uploadMbps: number },
): ThresholdViolations {
	return {
		latency: thresholds.latencyMs > 0 && network.latency > thresholds.latencyMs,
		download:
			thresholds.downloadMbps > 0 &&
			network.download_bytes_sec / BYTES_PER_MBPS < thresholds.downloadMbps,
		upload:
			thresholds.uploadMbps > 0 &&
			network.upload_bytes_sec / BYTES_PER_MBPS < thresholds.uploadMbps,
	};
}

export function hasAnyViolation(violations: ThresholdViolations): boolean {
	return violations.latency || violations.download || violations.upload;
}

export function getWarningCommand(violations: ThresholdViolations): string {
	const latencyOnly =
		violations.latency && !violations.download && !violations.upload;
	const throughputOnly =
		!violations.latency && (violations.download || violations.upload);

	if (latencyOnly) {
		return "coder.pingWorkspace";
	}
	if (throughputOnly) {
		return "coder.speedTest";
	}
	// Multiple types of violations — let the user choose
	return "coder.showNetworkDiagnostics";
}

export function buildNetworkTooltip(
	network: NetworkInfo,
	violations: ThresholdViolations,
	thresholds: { latencyMs: number; downloadMbps: number; uploadMbps: number },
): vscode.MarkdownString {
	const fmt = (bytesPerSec: number) =>
		prettyBytes(bytesPerSec * 8, { bits: true }) + "/s";

	const lines: string[] = [];

	let latencyLine = `Latency: ${network.latency.toFixed(2)}ms`;
	if (violations.latency) {
		latencyLine += ` $(warning) (threshold: ${thresholds.latencyMs}ms)`;
	}
	lines.push(latencyLine);

	let downloadLine = `Download: ${fmt(network.download_bytes_sec)}`;
	if (violations.download) {
		downloadLine += ` $(warning) (threshold: ${thresholds.downloadMbps} Mbit/s)`;
	}
	lines.push(downloadLine);

	let uploadLine = `Upload: ${fmt(network.upload_bytes_sec)}`;
	if (violations.upload) {
		uploadLine += ` $(warning) (threshold: ${thresholds.uploadMbps} Mbit/s)`;
	}
	lines.push(uploadLine);

	if (network.using_coder_connect) {
		lines.push("Connection: Coder Connect");
	} else if (network.p2p) {
		lines.push("Connection: Direct (P2P)");
	} else {
		lines.push(`Connection: ${network.preferred_derp} (relay)`);
	}

	if (hasAnyViolation(violations)) {
		lines.push("");
		lines.push(
			"_Click for diagnostics_ | [Configure thresholds](command:workbench.action.openSettings?%22coder.networkThreshold%22)",
		);
	}

	const md = new vscode.MarkdownString(lines.join("\n\n"));
	md.isTrusted = true;
	md.supportThemeIcons = true;
	return md;
}

/**
 * Manages network status bar presentation and slowness warning state.
 * Owns the warning debounce logic, status bar updates, and the
 * diagnostics command registration.
 */
export class NetworkStatusReporter implements vscode.Disposable {
	private warningCounter = 0;
	private isWarningActive = false;
	private readonly diagnosticsCommand: vscode.Disposable;

	constructor(private readonly statusBarItem: vscode.StatusBarItem) {
		this.diagnosticsCommand = vscode.commands.registerCommand(
			"coder.showNetworkDiagnostics",
			async () => {
				const pick = await vscode.window.showQuickPick(
					[
						{ label: "Run Ping", commandId: "coder.pingWorkspace" },
						{ label: "Run Speed Test", commandId: "coder.speedTest" },
						{
							label: "Create Support Bundle",
							commandId: "coder.supportBundle",
						},
					],
					{ placeHolder: "Select a diagnostic to run" },
				);
				if (pick) {
					await vscode.commands.executeCommand(pick.commandId);
				}
			},
		);
	}

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
		const violations = checkThresholdViolations(network, thresholds);
		const activeViolations = this.updateWarningState(violations);

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
			this.statusBarItem.backgroundColor = new vscode.ThemeColor(
				"statusBarItem.warningBackground",
			);
			this.statusBarItem.command = getWarningCommand(activeViolations);
		} else {
			this.statusBarItem.backgroundColor = undefined;
			this.statusBarItem.command = undefined;
		}

		this.statusBarItem.tooltip = buildNetworkTooltip(
			network,
			activeViolations,
			thresholds,
		);

		this.statusBarItem.show();
	}

	/**
	 * Updates the debounce counter and returns the effective violations
	 * (current violations when warning is active, all-clear otherwise).
	 */
	private updateWarningState(
		violations: ThresholdViolations,
	): ThresholdViolations {
		if (hasAnyViolation(violations)) {
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

		return this.isWarningActive ? violations : NO_VIOLATIONS;
	}

	dispose(): void {
		this.diagnosticsCommand.dispose();
	}
}
