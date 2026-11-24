import { afterEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import { createRemoteFileUsage, readRemoteFile } from "@/memory/remoteFiles";

import type { MemorySample } from "@/memory/usage";

const GiB = 1024 ** 3;
const MEMINFO_16G =
	"MemTotal:       16777216 kB\nMemFree:  1 kB\nMemAvailable:   12582912 kB\n";
const PSI =
	"some avg10=25.50 avg60=3.00 avg300=1.00 total=1\nfull avg10=9.00\n";
const V2_MOUNT = "30 1 0:26 / /sys/fs/cgroup rw - cgroup2 cgroup2 rw\n";
const V1_MOUNT =
	"40 1 0:30 / /sys/fs/cgroup/memory rw - cgroup cgroup rw,memory\n";

/** Reads `files`, with cgroups mounted at their usual places unless overridden. */
function reader(files: Record<string, string>) {
	const all: Record<string, string> = {
		"/proc/self/mountinfo": V2_MOUNT + V1_MOUNT,
		...files,
	};
	return (path: string) => Promise.resolve<string | undefined>(all[path]);
}

describe("createRemoteFileUsage", () => {
	it.each<{
		name: string;
		files: Record<string, string>;
		expected: MemorySample | undefined;
	}>([
		{
			name: "Kata VM: no cgroup limit, host memory, no PSI",
			files: {
				"/proc/self/cgroup": "0::/init\n",
				"/sys/fs/cgroup/init/memory.max": "max\n",
				"/proc/meminfo": MEMINFO_16G,
			},
			expected: {
				usedBytes: 4 * GiB,
				totalBytes: 16 * GiB,
				pressure: undefined,
				source: "host",
			},
		},
		{
			name: "cgroup v2: used is summed from one memory.stat read, not the fresher memory.current",
			files: {
				"/proc/self/cgroup": "0::/\n",
				"/sys/fs/cgroup/memory.max": String(8 * GiB),
				"/sys/fs/cgroup/memory.current": String(6 * GiB),
				// shmem stays counted: it is in file but not on the file LRU lists.
				"/sys/fs/cgroup/memory.stat": `anon ${GiB}\nfile ${2 * GiB}\nkernel ${0.5 * GiB}\nsock 0\nshmem ${0.5 * GiB}\nactive_file ${GiB}\ninactive_file ${0.5 * GiB}\nslab_reclaimable ${0.25 * GiB}`,
				"/sys/fs/cgroup/memory.pressure": PSI,
				"/proc/meminfo": MEMINFO_16G,
			},
			expected: {
				usedBytes: 1.75 * GiB,
				totalBytes: 8 * GiB,
				pressure: 25.5,
				source: "cgroup",
			},
		},
		{
			name: "cgroup v2 without the kernel key (Linux before 5.18): limit with least room wins, usage at the limit owner",
			files: {
				"/proc/self/cgroup": "0::/user/app\n",
				"/sys/fs/cgroup/user/app/memory.max": "max",
				// 0.75 GiB of room, counting siblings under the limit owner.
				"/sys/fs/cgroup/user/memory.max": String(2 * GiB),
				"/sys/fs/cgroup/user/memory.current": String(2 * GiB),
				"/sys/fs/cgroup/user/memory.stat": `anon 1\nshmem ${0.25 * GiB}\nactive_file ${0.25 * GiB}\ninactive_file ${0.25 * GiB}\nslab_reclaimable ${0.25 * GiB}`,
				"/sys/fs/cgroup/user/memory.pressure": PSI,
				// 1 GiB of room, so it is not hit first.
				"/sys/fs/cgroup/memory.max": String(8 * GiB),
				"/sys/fs/cgroup/memory.current": String(7 * GiB),
				"/sys/fs/cgroup/memory.stat": "inactive_file 0",
			},
			expected: {
				usedBytes: 1.25 * GiB,
				totalBytes: 2 * GiB,
				pressure: 25.5,
				source: "cgroup",
			},
		},
		{
			name: "cgroup v2 limit above host memory (overcommit): the host has less room, with host PSI",
			files: {
				"/proc/self/cgroup": "0::/\n",
				"/sys/fs/cgroup/memory.max": String(64 * GiB),
				"/sys/fs/cgroup/memory.current": String(GiB),
				"/sys/fs/cgroup/memory.stat": "anon 1",
				"/proc/meminfo": MEMINFO_16G,
				"/proc/pressure/memory": PSI,
			},
			expected: {
				usedBytes: 4 * GiB,
				totalBytes: 16 * GiB,
				pressure: 25.5,
				source: "host",
			},
		},
		{
			name: "cgroup v2: the limit owner has no usage files, so the nearest cgroup's usage counts",
			files: {
				"/proc/self/cgroup": "0::/app\n",
				"/sys/fs/cgroup/app/memory.current": String(3 * GiB),
				"/sys/fs/cgroup/app/memory.stat": `inactive_file ${GiB}`,
				"/sys/fs/cgroup/memory.max": String(4 * GiB),
			},
			expected: {
				usedBytes: 2 * GiB,
				totalBytes: 4 * GiB,
				pressure: undefined,
				source: "cgroup",
			},
		},
		{
			name: "cgroup v1 limit (sysbox, older Docker): host PSI is machine-wide, so it is left out",
			files: {
				"/proc/self/cgroup":
					"5:cpu,cpuacct:/docker/abc\n4:memory:/docker/abc\n",
				// Docker mounts the container's own cgroup.
				"/proc/self/mountinfo":
					"40 1 0:30 /docker/abc /sys/fs/cgroup/memory rw - cgroup cgroup rw,memory\n",
				"/sys/fs/cgroup/memory/memory.limit_in_bytes": String(8 * GiB),
				"/sys/fs/cgroup/memory/memory.usage_in_bytes": String(3 * GiB),
				"/sys/fs/cgroup/memory/memory.stat": `cache 1\ntotal_active_file ${0.5 * GiB}\ntotal_inactive_file ${0.5 * GiB}\n`,
				"/proc/meminfo": MEMINFO_16G,
				"/proc/pressure/memory": PSI,
			},
			expected: {
				usedBytes: 2 * GiB,
				totalBytes: 8 * GiB,
				pressure: undefined,
				source: "cgroup",
			},
		},
		...["9223372036854771712", String(32 * GiB)].map((limit) => ({
			name: `cgroup v1 limit ${limit} has more room than the host, so host memory counts`,
			files: {
				"/proc/self/cgroup": "4:memory:/\n",
				"/sys/fs/cgroup/memory/memory.limit_in_bytes": limit,
				"/sys/fs/cgroup/memory/memory.usage_in_bytes": String(GiB),
				"/sys/fs/cgroup/memory/memory.stat": "total_inactive_file 0",
				"/proc/meminfo": MEMINFO_16G,
			},
			expected: {
				usedBytes: 4 * GiB,
				totalBytes: 16 * GiB,
				pressure: undefined,
				source: "host" as const,
			},
		})),
		{
			name: "cgroup v2 mounted at a parent of the process's cgroup: the mount root maps the path",
			files: {
				"/proc/self/cgroup": "0::/kubepods/pod/ctr\n",
				"/proc/self/mountinfo":
					"30 1 0:26 /kubepods/pod /sys/fs/cgroup rw - cgroup2 cgroup2 rw\n",
				"/sys/fs/cgroup/ctr/memory.max": String(2 * GiB),
				"/sys/fs/cgroup/ctr/memory.current": String(GiB),
				"/sys/fs/cgroup/ctr/memory.stat": "anon 1",
			},
			expected: {
				usedBytes: GiB,
				totalBytes: 2 * GiB,
				pressure: undefined,
				source: "cgroup",
			},
		},
		{
			name: "hybrid: memory is on cgroup v1, with the limit set on a parent cgroup that is not readable",
			files: {
				"/proc/self/cgroup": "4:memory:/user.slice/job\n0::/user.slice/job\n",
				"/proc/self/mountinfo":
					"30 1 0:26 / /sys/fs/cgroup/unified rw - cgroup2 cgroup2 rw\n" +
					V1_MOUNT,
				"/sys/fs/cgroup/memory/user.slice/job/memory.limit_in_bytes":
					"9223372036854771712",
				"/sys/fs/cgroup/memory/user.slice/job/memory.usage_in_bytes": String(
					3 * GiB,
				),
				"/sys/fs/cgroup/memory/user.slice/job/memory.stat": `hierarchical_memory_limit ${4 * GiB}\ntotal_inactive_file ${GiB}`,
				"/proc/meminfo": MEMINFO_16G,
			},
			expected: {
				usedBytes: 2 * GiB,
				totalBytes: 4 * GiB,
				pressure: undefined,
				source: "cgroup",
			},
		},
		{
			name: "cgroup v1 limit on a readable parent: usage at the parent counts sibling cgroups",
			files: {
				"/proc/self/cgroup": "4:memory:/user.slice/job\n",
				"/sys/fs/cgroup/memory/user.slice/job/memory.limit_in_bytes":
					"9223372036854771712",
				"/sys/fs/cgroup/memory/user.slice/job/memory.usage_in_bytes":
					String(GiB),
				"/sys/fs/cgroup/memory/user.slice/job/memory.stat": `hierarchical_memory_limit ${4 * GiB}\ntotal_inactive_file 0`,
				"/sys/fs/cgroup/memory/user.slice/memory.limit_in_bytes": String(
					4 * GiB,
				),
				"/sys/fs/cgroup/memory/user.slice/memory.usage_in_bytes": String(
					3.5 * GiB,
				),
				"/sys/fs/cgroup/memory/user.slice/memory.stat": `total_inactive_file ${0.5 * GiB}`,
				"/proc/meminfo": MEMINFO_16G,
			},
			expected: {
				usedBytes: 3 * GiB,
				totalBytes: 4 * GiB,
				pressure: undefined,
				source: "cgroup",
			},
		},
		{
			name: "nothing readable",
			files: { "/proc/self/cgroup": "0::/\n" },
			expected: undefined,
		},
	])("$name", async ({ files, expected }) => {
		expect(await createRemoteFileUsage(reader(files))()).toEqual(expected);
	});

	it("reads one batch per poll and follows the server to a new cgroup", async () => {
		const files: Record<string, string> = {
			"/proc/self/cgroup": "0::/a\n",
			"/sys/fs/cgroup/a/memory.max": String(4 * GiB),
			"/sys/fs/cgroup/a/memory.current": String(GiB),
			"/sys/fs/cgroup/a/memory.stat": "inactive_file 0",
			"/sys/fs/cgroup/b/memory.max": String(8 * GiB),
			"/sys/fs/cgroup/b/memory.current": String(2 * GiB),
			"/sys/fs/cgroup/b/memory.stat": "inactive_file 0",
		};
		let batches = 0;
		const usage = createRemoteFileUsage((path) => {
			if (path === "/proc/self/cgroup") {
				batches++;
			}
			return reader(files)(path);
		});

		// The first poll learns the cgroup, then reads its files.
		expect(await usage()).toMatchObject({ totalBytes: 4 * GiB });
		expect(batches).toBe(2);
		expect(await usage()).toMatchObject({ totalBytes: 4 * GiB });
		expect(batches).toBe(3);

		files["/proc/self/cgroup"] = "0::/b\n";
		expect(await usage()).toMatchObject({ totalBytes: 8 * GiB });
		expect(batches).toBe(5);
	});
});

describe("readRemoteFile", () => {
	const env = vscode.env as { remoteAuthority?: string };

	afterEach(() => {
		delete env.remoteAuthority;
		vi.mocked(vscode.workspace.fs.readFile).mockReset();
	});

	it("reads through the window's remote authority", async () => {
		expect(await readRemoteFile("/proc/meminfo")).toBeUndefined();

		env.remoteAuthority = "dev-container+abc@coder-vscode--alice--dev";
		vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
			new TextEncoder().encode("0::/\n"),
		);
		expect(await readRemoteFile("/proc/self/cgroup")).toBe("0::/\n");
		expect(vi.mocked(vscode.workspace.fs.readFile).mock.calls).toEqual([
			[
				expect.objectContaining({
					scheme: "vscode-remote",
					authority: "dev-container+abc@coder-vscode--alice--dev",
					path: "/proc/self/cgroup",
				}),
			],
		]);
	});
});
