import type { NetworkInfo } from "../remote/sshProcess";
import type { TelemetryReporter } from "../telemetry/reporter";

const NETWORK_SAMPLE_INTERVAL_MS = 60_000;
const NETWORK_LATENCY_CHANGE_RATIO = 0.1;

export type ProcessLossCause = "stale_network_info" | "missing_network_info";

interface NetworkSample {
	readonly emittedAtMs: number;
	readonly p2p: boolean;
	readonly preferredDerp: string;
	readonly latencyMs: number;
}

interface ProcessDiscoveryResult {
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
			span.setProperty("found", String(pid !== undefined));
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

	/** Handover to a different SSH process. Always emits `ssh.process.replaced`,
	 * even when the prior process was already lost (replacement is operationally
	 * distinct from recovery). */
	public processReplaced(): void {
		const now = performance.now();
		if (this.#processStartedAtMs !== undefined) {
			const wasLost = this.#processLostAtMs !== undefined;
			const measurements: Record<string, number> = {
				previousUptimeMs: now - this.#processStartedAtMs,
			};
			if (this.#processLostAtMs !== undefined) {
				measurements.lostDurationMs = now - this.#processLostAtMs;
			}
			this.#telemetry.log(
				"ssh.process.replaced",
				{ wasLost: String(wasLost) },
				measurements,
			);
		}
		this.#processStartedAtMs = now;
		this.#processLostAtMs = undefined;
		this.#lastNetworkSample = undefined;
	}

	/** Terminal teardown signal. Emits regardless of prior lost state so
	 * consumers always see a session-ending event. */
	public disposed(): void {
		if (this.#processStartedAtMs === undefined) {
			return;
		}
		const now = performance.now();
		const wasLost = this.#processLostAtMs !== undefined;
		this.#telemetry.log(
			"ssh.process.disposed",
			{ wasLost: String(wasLost) },
			{ uptimeMs: now - this.#processStartedAtMs },
		);
		this.#processStartedAtMs = undefined;
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
			preferredDerp: network.preferred_derp,
			latencyMs: network.latency,
		};
		this.#telemetry.log(
			"ssh.network.sampled",
			{
				p2p: String(network.p2p),
				preferredDerp: network.preferred_derp,
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
	if (current.preferred_derp !== previous.preferredDerp) {
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
