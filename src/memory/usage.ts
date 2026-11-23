const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

/** Memory of the cgroup (or host) whose limit the workspace runs under. */
export interface MemorySample {
	readonly usedBytes: number;
	readonly totalBytes: number;
	/** PSI `some avg10` in percent; undefined when it is not known. */
	readonly pressure?: number;
	/** Whether a cgroup limit or the host's memory bounds usage. */
	readonly source: "cgroup" | "host";
}

/**
 * Takes one memory sample of the connected workspace; undefined when memory
 * cannot be read. `MemoryMonitor` polls whichever source the window uses.
 */
export type MemoryUsageSource = () => Promise<MemorySample | undefined>;

/** `6.12/16 GiB`, like the RAM line of `coder stat mem`. */
export function formatUsage(sample: MemorySample): string {
	const [unit, size] = sample.totalBytes >= GIB ? ["GiB", GIB] : ["MiB", MIB];
	const format = (bytes: number) => String(Number((bytes / size).toFixed(2)));
	return `${format(sample.usedBytes)}/${format(sample.totalBytes)} ${unit}`;
}
