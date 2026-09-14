import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import experimentModule from "../experiment.cjs";

const {
	buildEnvironment,
	CELLS,
	electron37Path,
	parseArguments,
	parsePortableExecutable,
	targetEnvironmentName,
	vitestEntrypoint,
	verifyStaticRuntime,
} = experimentModule;
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), "windows-acl-experiment-"),
	);
	temporaryDirectories.push(directory);
	return directory;
}

function syntheticPortableExecutable(
	machine: number,
	importName: string,
): Buffer {
	const buffer = Buffer.alloc(0x400);
	buffer.write("MZ", 0, "ascii");
	buffer.writeUInt32LE(0x80, 0x3c);
	buffer.write("PE\0\0", 0x80, "ascii");
	buffer.writeUInt16LE(machine, 0x84);
	buffer.writeUInt16LE(1, 0x86);
	buffer.writeUInt16LE(0xf0, 0x94);
	buffer.writeUInt16LE(0x20b, 0x98);
	buffer.writeUInt32LE(0x1000, 0x98 + 112 + 8);
	const section = 0x188;
	buffer.write(".rdata", section, "ascii");
	buffer.writeUInt32LE(0x200, section + 8);
	buffer.writeUInt32LE(0x1000, section + 12);
	buffer.writeUInt32LE(0x200, section + 16);
	buffer.writeUInt32LE(0x200, section + 20);
	buffer.writeUInt32LE(0x1080, 0x200 + 12);
	buffer.writeUInt32LE(0, 0x200 + 20);
	buffer.write(importName, 0x280, "ascii");
	return buffer;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

describe("experiment", () => {
	it("accepts only supported Windows Rust targets", () => {
		expect(parseArguments(["--target", "x86_64-pc-windows-msvc"])).toBe(
			"x86_64-pc-windows-msvc",
		);
		expect(() => parseArguments([])).toThrow("--target is required");
		expect(() => parseArguments(["--target", "unsupported"])).toThrow(
			"Unsupported Rust target",
		);
		expect(() => parseArguments(["--unknown"])).toThrow("Unknown argument");
	});

	it("includes the projection dependency comparison cell", () => {
		const projection = CELLS.find((cell) => cell.name === "projection-s");
		expect(projection).toMatchObject({
			source: "current",
			optLevel: "s",
			crtStatic: false,
			features: [
				"acl-prototype-helper/projection",
				"acl-prototype-addon/projection",
			],
		});
	});

	it("compares typed bindings with identical settings except CRT linkage", () => {
		const dynamic = CELLS.find((cell) => cell.name === "projection-s");
		const staticCell = CELLS.find(
			(cell) => cell.name === "projection-s-static",
		);
		expect(dynamic).toBeDefined();
		expect(staticCell).toEqual({
			...dynamic,
			name: "projection-s-static",
			crtStatic: true,
		});
	});

	it.each([
		"VCRUNTIME140.dll",
		"vcruntime140_1.dll",
		"MSVCP140.dll",
		"msvcrt.dll",
		"ucrtbase.dll",
		"api-ms-win-crt-runtime-l1-1-0.dll",
	])("rejects a static payload importing %s", (name) => {
		expect(() =>
			verifyStaticRuntime([
				{
					name: "acl-helper.exe",
					pe: { architecture: "x64", imports: ["KERNEL32.dll", name] },
				},
			]),
		).toThrow(`imports runtime DLLs: ${name}`);
	});

	it("allows Windows OS imports in both static payloads", () => {
		expect(() =>
			verifyStaticRuntime([
				{
					name: "acl-helper.exe",
					pe: {
						architecture: "x64",
						imports: ["KERNEL32.dll", "advapi32.dll"],
					},
				},
				{
					name: "acl.node",
					pe: { architecture: "arm64", imports: ["ntdll.dll"] },
				},
			]),
		).not.toThrow();
	});

	it("uses distinct target directories and Cargo profile overrides", () => {
		const directory = temporaryDirectory();
		const previousRustFlags = process.env.RUSTFLAGS;
		const previousEncodedRustFlags = process.env.CARGO_ENCODED_RUSTFLAGS;
		process.env.RUSTFLAGS = "-C debuginfo=2";
		process.env.CARGO_ENCODED_RUSTFLAGS = "-C\x1fdebuginfo=2";
		try {
			const dynamic = buildEnvironment(
				"x86_64-pc-windows-msvc",
				{
					name: "simplified-s",
					source: "current",
					optLevel: "s",
					crtStatic: false,
				},
				directory,
			);
			const staticEnvironment = buildEnvironment(
				"aarch64-pc-windows-msvc",
				{
					name: "simplified-s-static",
					source: "current",
					optLevel: "s",
					crtStatic: true,
				},
				path.join(directory, "static"),
			);

			expect(dynamic.CARGO_TARGET_DIR).toBe(directory);
			expect(dynamic.CARGO_PROFILE_RELEASE_OPT_LEVEL).toBe("s");
			expect(dynamic.CARGO_PROFILE_RELEASE_PANIC).toBe("unwind");
			expect(dynamic.CARGO_PROFILE_RELEASE_LTO).toBe("true");
			expect(dynamic.CARGO_PROFILE_RELEASE_STRIP).toBe("true");
			expect(dynamic.RUSTFLAGS).toBeUndefined();
			expect(dynamic.CARGO_ENCODED_RUSTFLAGS).toBeUndefined();
			expect(
				dynamic[targetEnvironmentName("x86_64-pc-windows-msvc")],
			).toBeUndefined();
			expect(
				staticEnvironment[targetEnvironmentName("aarch64-pc-windows-msvc")],
			).toBe("-C target-feature=+crt-static");
			expect(
				buildEnvironment(
					"x86_64-pc-windows-msvc",
					{ name: "original", source: "baseline" },
					directory,
				).CARGO_PROFILE_RELEASE_OPT_LEVEL,
			).toBeUndefined();
		} finally {
			if (previousRustFlags === undefined) delete process.env.RUSTFLAGS;
			else process.env.RUSTFLAGS = previousRustFlags;
			if (previousEncodedRustFlags === undefined) {
				delete process.env.CARGO_ENCODED_RUSTFLAGS;
			} else {
				process.env.CARGO_ENCODED_RUSTFLAGS = previousEncodedRustFlags;
			}
		}
	});

	it("requires an absolute Electron 37 executable path", () => {
		expect(() => electron37Path("")).toThrow("ACL_ELECTRON37_PATH");
		expect(() => electron37Path("relative/electron.exe")).toThrow(
			"ACL_ELECTRON37_PATH",
		);
	});

	it("resolves Vitest through its exported package manifest", () => {
		expect(path.basename(vitestEntrypoint())).toBe("vitest.mjs");
		expect(fs.statSync(vitestEntrypoint()).isFile()).toBe(true);
	});

	it("reads architectures and imports from PE fixtures", () => {
		expect(
			parsePortableExecutable(
				syntheticPortableExecutable(0x8664, "KERNEL32.dll"),
			),
		).toEqual({ architecture: "x64", imports: ["KERNEL32.dll"] });
		expect(
			parsePortableExecutable(
				syntheticPortableExecutable(0xaa64, "ADVAPI32.dll"),
			),
		).toEqual({ architecture: "arm64", imports: ["ADVAPI32.dll"] });
		expect(() => parsePortableExecutable(Buffer.from("not pe"))).toThrow(
			"Not a PE file",
		);
	});
});
