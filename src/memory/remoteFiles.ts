// A port of coder/clistat's memory reading (`coder stat mem`), following
// https://github.com/coder/clistat/tree/3a2651d6a78ed5b70332fb50bc99d1e553a28e15
// except where parseMemorySample notes a difference. Keep it in step with
// clistat.

import * as vscode from "vscode";

import { vscodeProposed } from "../vscode/proposed";

import type { MemorySample, MemoryUsageSource } from "./usage";

// Docker writes 2^63 - 1 rounded to a page for "no limit"; anything this
// large cannot be a real limit, and Number cannot represent it exactly.
const CGROUP_V1_UNLIMITED = 2 ** 62;
const PROC_SELF_CGROUP = "/proc/self/cgroup";
const PROC_SELF_MOUNTINFO = "/proc/self/mountinfo";
const MEMINFO = "/proc/meminfo";
const HOST_PRESSURE = "/proc/pressure/memory";
const VMSTAT = "/proc/vmstat";
const HOST_FILES = [MEMINFO, HOST_PRESSURE, VMSTAT] as const;
const CGROUP_V1_FILES = [
	"memory.limit_in_bytes",
	"memory.usage_in_bytes",
	"memory.stat",
	"memory.oom_control",
] as const;
const CGROUP_V2_FILES = [
	"memory.max",
	"memory.current",
	"memory.stat",
	"memory.events",
	"memory.pressure",
] as const;
/**
 * `memory.stat` keys the kernel reclaims before an OOM kill: the file LRU
 * lists and reclaimable slab. tmpfs and shared memory sit on the anon lists,
 * so they stay counted.
 */
const CGROUP_V2_RECLAIMABLE = [
	"active_file",
	"inactive_file",
	"slab_reclaimable",
] as const;
const CGROUP_V1_RECLAIMABLE = [
	"total_active_file",
	"total_inactive_file",
] as const;

/** Reads a file on the workspace; undefined when it is missing or unreadable. */
export type ReadWorkspaceFile = (path: string) => Promise<string | undefined>;

/**
 * Reads files on the machine this remote window is connected to, through
 * the VS Code server's file system. Uses the window's own authority, which
 * for a dev container is the container, not the workspace host.
 */
export async function readRemoteFile(
	path: string,
): Promise<string | undefined> {
	const authority = vscodeProposed.env.remoteAuthority;
	if (!authority) {
		return undefined;
	}
	const uri = vscode.Uri.from({ scheme: "vscode-remote", authority, path });
	try {
		return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
	} catch {
		return undefined;
	}
}

/**
 * Memory read from the cgroup and `/proc` files of the machine the window is
 * connected to. A poll reads every file it may need in one parallel batch,
 * which is one round trip to the remote, then parses them.
 */
export function createRemoteFileUsage(
	read: ReadWorkspaceFile = readRemoteFile,
): MemoryUsageSource {
	let cgroups: Cgroups = { v2: [], v1: undefined };
	return async () => {
		let file = await readFiles(read, batchPaths(cgroups));
		// The batch read the cgroup files of the last poll's cgroups. When the
		// server is in others (first poll, or it moved), read them again.
		const current = findCgroups(
			file(PROC_SELF_CGROUP),
			file(PROC_SELF_MOUNTINFO),
		);
		if (JSON.stringify(current) !== JSON.stringify(cgroups)) {
			cgroups = current;
			file = await readFiles(read, batchPaths(cgroups));
		}
		return parseMemorySample(file, cgroups);
	};
}

type Files = (path: string) => string | undefined;

async function readFiles(
	read: ReadWorkspaceFile,
	paths: readonly string[],
): Promise<Files> {
	const texts = await Promise.all(paths.map((path) => read(path)));
	const files = new Map(paths.map((path, i) => [path, texts[i]]));
	return (path) => files.get(path);
}

/** Every file a poll may need, given the cgroups of the last poll. */
function batchPaths({ v2, v1 }: Cgroups): string[] {
	return [
		PROC_SELF_CGROUP,
		PROC_SELF_MOUNTINFO,
		...HOST_FILES,
		...(v1 === undefined ? [] : CGROUP_V1_FILES.map((f) => `${v1}/${f}`)),
		...v2.flatMap((dir) => CGROUP_V2_FILES.map((f) => `${dir}/${f}`)),
	];
}

interface Limit {
	readonly used: number;
	readonly total: number;
	readonly pressureFile: string;
}

/**
 * Used is memory the kernel cannot reclaim without killing or swapping:
 * `MemTotal - MemAvailable` on the host (as `free` and `top` report it), and
 * usage minus the file LRU lists and reclaimable slab in a cgroup.
 *
 * The rest follows clistat:
 * - cgroup v2: `cgroupV2Statter.memory`. The `memory.max` with the least
 *   room left, with usage at the limit owner, falling back to the nearest
 *   cgroup that has usage files.
 * - cgroup v1: `cgroupV1Statter.memory`.
 * - Host: `Statter.HostMemory`.
 *
 * It differs from clistat in these ways:
 * - clistat subtracts only `inactive_file` in a cgroup.
 * - No `IsContainerized` check: any limit applies. Without one, host usage
 *   and total are used, since everything on the host competes for that
 *   memory; clistat reports the cgroup's own usage with no total.
 * - A cgroup v1 limit at or above host memory counts as no limit.
 * - It reads PSI and OOM kill counters, which clistat does not.
 * - It finds cgroups through `/proc/self/mountinfo`, and takes a v1 limit
 *   set on a parent from `hierarchical_memory_limit`; clistat reads fixed
 *   paths.
 */
function parseMemorySample(
	file: Files,
	cgroups: Cgroups,
): MemorySample | undefined {
	const meminfo = file(MEMINFO) ?? "";
	const hostTotal = parseMeminfoBytes(meminfo, "MemTotal");
	const cgroup =
		cgroupV2Limit(file, cgroups.v2) ??
		cgroupV1Limit(file, cgroups.v1, hostTotal);
	const limit = cgroup ?? hostLimit(meminfo, hostTotal);
	if (!limit) {
		return undefined;
	}
	return {
		usedBytes: limit.used,
		totalBytes: limit.total,
		pressure: parsePressure(file(limit.pressureFile)),
		oomKills: oomKills(file, cgroups),
		source: cgroup ? "cgroup" : "host",
	};
}

function hostLimit(
	meminfo: string,
	total: number | undefined,
): Limit | undefined {
	const available = parseMeminfoBytes(meminfo, "MemAvailable");
	if (!total || available === undefined) {
		return undefined;
	}
	return {
		used: Math.max(total - available, 0),
		total,
		pressureFile: HOST_PRESSURE,
	};
}

/**
 * Every `memory.max` from the process up to the root applies; the one with
 * the least room left is hit first. Ties go to the nearest cgroup.
 */
function cgroupV2Limit(
	file: Files,
	dirs: readonly string[],
): Limit | undefined {
	const cgroups = dirs.map((dir) => ({
		dir,
		// `max`, meaning no limit, does not parse as a number.
		total: parseNumber(file(`${dir}/memory.max`)),
		used: usedBytes(
			file(`${dir}/memory.current`),
			file(`${dir}/memory.stat`),
			CGROUP_V2_RECLAIMABLE,
		),
	}));
	// Usage at the limit owner counts sibling cgroups under it; like clistat,
	// fall back to the nearest cgroup that exposes usage.
	const nearestUsed = cgroups.find((c) => c.used !== undefined)?.used;
	let best: Limit | undefined;
	for (const cgroup of cgroups) {
		const total = cgroup.total;
		const used = cgroup.used ?? nearestUsed;
		if (total === undefined || used === undefined) {
			continue;
		}
		if (!best || total - used < best.total - best.used) {
			best = { used, total, pressureFile: `${cgroup.dir}/memory.pressure` };
		}
	}
	return best;
}

/**
 * A cgroup v1 limit, the lower of the cgroup's own and its parents'
 * (`hierarchical_memory_limit`); one at or above host memory is no limit.
 */
function cgroupV1Limit(
	file: Files,
	dir: string | undefined,
	hostTotal: number | undefined,
): Limit | undefined {
	if (dir === undefined) {
		return undefined;
	}
	const stat = file(`${dir}/memory.stat`);
	const total = Math.min(
		parseNumber(file(`${dir}/memory.limit_in_bytes`)) ?? Infinity,
		parseKeyedValue(stat, "hierarchical_memory_limit") ?? Infinity,
	);
	if (
		total >= CGROUP_V1_UNLIMITED ||
		(hostTotal !== undefined && total >= hostTotal)
	) {
		return undefined;
	}
	const used = usedBytes(
		file(`${dir}/memory.usage_in_bytes`),
		stat,
		CGROUP_V1_RECLAIMABLE,
	);
	return used === undefined
		? undefined
		: { used, total, pressureFile: HOST_PRESSURE };
}

/** Usage minus memory the kernel can reclaim; a missing key counts as 0. */
function usedBytes(
	usage: string | undefined,
	stat: string | undefined,
	reclaimableKeys: readonly string[],
): number | undefined {
	const current = parseNumber(usage);
	if (current === undefined || stat === undefined) {
		return undefined;
	}
	const reclaimable = reclaimableKeys.reduce(
		(sum, key) => sum + (parseKeyedValue(stat, key) ?? 0),
		0,
	);
	return Math.max(current - reclaimable, 0);
}

/**
 * The first OOM kill counter found, from the same file on every poll.
 * `memory.events` is hierarchical, so the outermost cgroup we can see counts
 * kills anywhere in the workspace.
 */
function oomKills(file: Files, { v2, v1 }: Cgroups): MemorySample["oomKills"] {
	const counters = [
		...v2.toReversed().map((dir) => `${dir}/memory.events`),
		...(v1 === undefined ? [] : [`${v1}/memory.oom_control`]),
		VMSTAT,
	];
	for (const counter of counters) {
		const count = parseKeyedValue(file(counter), "oom_kill");
		if (count !== undefined) {
			return { count, counter };
		}
	}
	return undefined;
}

/** Where the process's memory cgroups are mounted. */
interface Cgroups {
	/** cgroup v2 directories from the process's cgroup up to the mount. */
	readonly v2: readonly string[];
	/** The process's cgroup v1 memory directory. */
	readonly v1: string | undefined;
}

/**
 * Maps the process's cgroups (`/proc/self/cgroup`) to directories through
 * the cgroup mounts (`/proc/self/mountinfo`). Both name cgroups from the
 * cgroup namespace root, so a mount whose root is `/docker/abc` shows
 * `/docker/abc/x` at `<mount point>/x`.
 */
function findCgroups(
	procCgroup: string | undefined,
	mountinfo: string | undefined,
): Cgroups {
	// Lines are `id:controllers:path`; v2 has id 0 and no controllers.
	const entries = (procCgroup ?? "").split("\n").map((l) => l.split(":"));
	const v2Path = entries
		.find(([id]) => id === "0")
		?.slice(2)
		.join(":");
	const v1Path = entries
		.find(([, controllers]) => controllers?.split(",").includes("memory"))
		?.slice(2)
		.join(":");
	return {
		v2: cgroupDirs(findMount(mountinfo, "cgroup2"), v2Path),
		v1: cgroupDirs(findMount(mountinfo, "cgroup", "memory"), v1Path)[0],
	};
}

interface Mount {
	readonly root: string;
	readonly point: string;
}

/** The first mount of `type`, with `option` among its super options. */
function findMount(
	mountinfo: string | undefined,
	type: string,
	option?: string,
): Mount | undefined {
	// `id parent dev root point options... - type source superOptions`
	for (const line of (mountinfo ?? "").split("\n")) {
		const [mount = "", fs = ""] = line.split(" - ");
		const [, , , root, point] = mount.split(" ");
		const [fsType, , superOptions = ""] = fs.split(" ");
		const hasOption = !option || superOptions.split(",").includes(option);
		if (fsType === type && hasOption && root && point) {
			return { root, point };
		}
	}
	return undefined;
}

/**
 * The cgroup's directory and its parents up to the mount point, nearest
 * first. Empty when the mount does not contain the cgroup.
 */
function cgroupDirs(
	mount: Mount | undefined,
	path: string | undefined,
): string[] {
	if (!mount || path === undefined) {
		return [];
	}
	const root = mount.root === "/" ? "" : mount.root;
	if (path !== root && !path.startsWith(`${root}/`)) {
		return [];
	}
	const parts = path.slice(root.length).split("/").filter(Boolean);
	return parts
		.map((_, i) => [mount.point, ...parts.slice(0, parts.length - i)].join("/"))
		.concat(mount.point);
}

function parseNumber(text: string | undefined): number | undefined {
	const trimmed = text?.trim();
	const value = Number(trimmed);
	return trimmed && Number.isFinite(value) ? value : undefined;
}

function parseMeminfoBytes(meminfo: string, key: string): number | undefined {
	const match = new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, "m").exec(meminfo);
	return match ? Number(match[1]) * 1024 : undefined;
}

/** A `key value` line, as in `memory.stat`, `memory.events` and `/proc/vmstat`. */
function parseKeyedValue(
	text: string | undefined,
	key: string,
): number | undefined {
	for (const line of text?.split("\n") ?? []) {
		const [name, value] = line.trim().split(/\s+/);
		if (name === key) {
			return parseNumber(value);
		}
	}
	return undefined;
}

/** The `some avg10` percentage of a PSI file. */
function parsePressure(text: string | undefined): number | undefined {
	const match = /^some\b.*\bavg10=([\d.]+)/m.exec(text ?? "");
	return match ? parseNumber(match[1]) : undefined;
}
