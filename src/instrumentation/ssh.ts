import type { NetworkInfo } from "../remote/sshProcess";
import type { TelemetryReporter } from "../telemetry/reporter";

const NETWORK_SAMPLE_INTERVAL_MS = 60_000;
const NETWORK_LATENCY_CHANGE_RATIO = 0.1;

export type ProcessLossCause =
	| "stale_network_info"
	| "missing_network_info"
	| "process_changed"
	| "disposed";

interface NetworkSample {
	readonly emittedAtMs: number;
	readonly p2p: boolean;
	readonly derp: string;
	readonly latencyMs: number;
}

export interface ProcessDiscoveryResult {
	readonly pid: number | undefined;
	readonly attempts: number;
}

export class SshTelemetry {
	readonly #telemetry: TelemetryReporter;
	#processStartedAtMs: number | undefined;
	#processLostAtMs: number | undefined;
	#lastNetworkSample: NetworkSample | undefined;

	public constructor(telemetry: TelemetryReporter) {
		this.#telemetry = telemetry;
	}

	public traceProcessDiscovery(
		fn: () => Promise<ProcessDiscoveryResult>,
	): Promise<number | undefined> {
		return this.#telemetry.trace("ssh.process.discovered", async (span) => {
			const { pid, attempts } = await fn();
			span.setMeasurement("attempts", attempts);
			return pid;
		});
	}

	public processStarted(): void {
		this.#processStartedAtMs = performance.now();
		this.#processLostAtMs = undefined;
	}

	public processLost(cause: ProcessLossCause): void {
		if (
			this.#processStartedAtMs === undefined ||
			this.#processLostAtMs !== undefined
		) {
			return;
		}
		const now = performance.now();
		this.#processLostAtMs = now;
		this.#telemetry.log(
			"ssh.process.lost",
			{ cause },
			{ uptimeMs: now - this.#processStartedAtMs },
		);
	}

	public processRecovered(): void {
		if (this.#processLostAtMs === undefined) {
			return;
		}
		this.#telemetry.log(
			"ssh.process.recovered",
			{},
			{ recoveryDurationMs: performance.now() - this.#processLostAtMs },
		);
		this.#processLostAtMs = undefined;
	}

	/**
	 * Handover from one SSH process to another. Closes out the prior process
	 * (recovery if lost, replacement otherwise) and starts fresh tracking.
	 */
	public processReplaced(): void {
		const now = performance.now();
		if (this.#processLostAtMs !== undefined) {
			this.processRecovered();
		} else if (this.#processStartedAtMs !== undefined) {
			this.#telemetry.log(
				"ssh.process.replaced",
				{},
				{ previousUptimeMs: now - this.#processStartedAtMs },
			);
		}
		this.#processStartedAtMs = now;
		this.#processLostAtMs = undefined;
		this.#lastNetworkSample = undefined;
	}

	public networkSampled(network: NetworkInfo): void {
		const now = performance.now();
		const previous = this.#lastNetworkSample;
		if (previous && !shouldEmitSample(previous, network, now)) {
			return;
		}

		this.#lastNetworkSample = {
			emittedAtMs: now,
			p2p: network.p2p,
			derp: network.preferred_derp,
			latencyMs: network.latency,
		};
		this.#telemetry.log(
			"ssh.network.sample",
			{
				p2p: String(network.p2p),
				derp: network.preferred_derp,
			},
			{
				latencyMs: network.latency,
				downloadMbits: bytesPerSecondToMbits(network.download_bytes_sec),
				uploadMbits: bytesPerSecondToMbits(network.upload_bytes_sec),
			},
		);
	}
}

/** Emit on p2p flip, DERP change, large latency swing, or heartbeat interval. */
function shouldEmitSample(
	previous: NetworkSample,
	current: NetworkInfo,
	now: number,
): boolean {
	if (now - previous.emittedAtMs >= NETWORK_SAMPLE_INTERVAL_MS) {
		return true;
	}
	if (current.p2p !== previous.p2p) {
		return true;
	}
	if (current.preferred_derp !== previous.derp) {
		return true;
	}
	return hasMeaningfulLatencyChange(current.latency, previous.latencyMs);
}

function hasMeaningfulLatencyChange(
	current: number,
	previous: number,
): boolean {
	if (previous === 0) {
		return current !== 0;
	}
	return Math.abs(current - previous) / previous > NETWORK_LATENCY_CHANGE_RATIO;
}

function bytesPerSecondToMbits(bytesPerSecond: number): number {
	return (bytesPerSecond * 8) / 1_000_000;
}
