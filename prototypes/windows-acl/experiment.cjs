#!/usr/bin/env node
"use strict";
/* global __dirname, console, process */

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const ARTIFACT_ROOT = path.join(ROOT, "artifacts");
const EXPERIMENT_ROOT = path.join(ARTIFACT_ROOT, "experiments");
const BASELINE_REVISION = "22a751efc2fc859641e387921e115d01829db1ac";
const WINDOWS_TARGETS = new Map([
	["x86_64-pc-windows-msvc", "x64"],
	["aarch64-pc-windows-msvc", "arm64"],
]);
const CELLS = [
	{ name: "original", source: "baseline" },
	{
		name: "simplified-3",
		source: "current",
		optLevel: "3",
		crtStatic: false,
	},
	{
		name: "simplified-s",
		source: "current",
		optLevel: "s",
		crtStatic: false,
	},
	{
		name: "projection-s",
		source: "current",
		optLevel: "s",
		crtStatic: false,
		features: [
			"acl-prototype-helper/projection",
			"acl-prototype-addon/projection",
		],
	},
	{
		name: "simplified-z",
		source: "current",
		optLevel: "z",
		crtStatic: false,
	},
	{
		name: "simplified-s-static",
		source: "current",
		optLevel: "s",
		crtStatic: true,
	},
];

function parseArguments(args) {
	let target;
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] !== "--target") {
			throw new Error(`Unknown argument: ${args[index]}`);
		}
		target = args[index + 1];
		if (!target) throw new Error("--target requires a Rust target triple");
		index += 1;
	}
	if (!target) throw new Error("--target is required");
	if (!WINDOWS_TARGETS.has(target)) {
		throw new Error(`Unsupported Rust target: ${target}`);
	}
	return target;
}

function targetEnvironmentName(target) {
	return `CARGO_TARGET_${target.toUpperCase().replaceAll("-", "_")}_RUSTFLAGS`;
}

function buildEnvironment(target, cell, targetDirectory) {
	const environment = { ...process.env, CARGO_TARGET_DIR: targetDirectory };
	delete environment.RUSTFLAGS;
	delete environment.CARGO_ENCODED_RUSTFLAGS;
	delete environment[targetEnvironmentName(target)];
	if (cell.source === "current") {
		environment.CARGO_PROFILE_RELEASE_OPT_LEVEL = cell.optLevel;
		environment.CARGO_PROFILE_RELEASE_PANIC = "unwind";
		environment.CARGO_PROFILE_RELEASE_LTO = "true";
		environment.CARGO_PROFILE_RELEASE_CODEGEN_UNITS = "1";
		environment.CARGO_PROFILE_RELEASE_STRIP = "true";
		if (cell.crtStatic) {
			environment[targetEnvironmentName(target)] =
				"-C target-feature=+crt-static";
		}
	} else {
		delete environment.CARGO_PROFILE_RELEASE_OPT_LEVEL;
		delete environment.CARGO_PROFILE_RELEASE_PANIC;
		delete environment.CARGO_PROFILE_RELEASE_LTO;
		delete environment.CARGO_PROFILE_RELEASE_CODEGEN_UNITS;
		delete environment.CARGO_PROFILE_RELEASE_STRIP;
	}
	return environment;
}

function baselineRoot(value = process.env.ACL_BASELINE_ROOT) {
	if (!value || !path.isAbsolute(value)) {
		throw new Error(
			"ACL_BASELINE_ROOT must be an absolute path to the baseline source",
		);
	}
	if (
		!fs
			.statSync(path.join(value, "Cargo.toml"), { throwIfNoEntry: false })
			?.isFile()
	) {
		throw new Error(
			`ACL_BASELINE_ROOT is not a Windows ACL source root: ${value}`,
		);
	}
	return value;
}

function sourceRootFor(cell, root, configuredBaselineRoot) {
	const sourceRoot =
		cell.source === "baseline" ? baselineRoot(configuredBaselineRoot) : root;
	if (
		cell.source === "baseline" &&
		sourceRevision(sourceRoot) !== BASELINE_REVISION
	) {
		throw new Error(`ACL_BASELINE_ROOT must be at ${BASELINE_REVISION}`);
	}
	return sourceRoot;
}

function readAscii(buffer, offset) {
	const end = buffer.indexOf(0, offset);
	if (end === -1) throw new Error("PE string is not NUL terminated");
	return buffer.toString("ascii", offset, end);
}

function parsePortableExecutable(buffer) {
	if (buffer.length < 0x40 || buffer.toString("ascii", 0, 2) !== "MZ") {
		throw new Error("Not a PE file");
	}
	const peOffset = buffer.readUInt32LE(0x3c);
	if (
		peOffset + 24 > buffer.length ||
		buffer.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0"
	) {
		throw new Error("Invalid PE signature");
	}
	const machine = buffer.readUInt16LE(peOffset + 4);
	const architecture = new Map([
		[0x8664, "x64"],
		[0xaa64, "arm64"],
	]).get(machine);
	if (!architecture)
		throw new Error(`Unsupported PE machine: 0x${machine.toString(16)}`);

	const sectionCount = buffer.readUInt16LE(peOffset + 6);
	const optionalHeaderSize = buffer.readUInt16LE(peOffset + 20);
	const optionalHeaderOffset = peOffset + 24;
	if (optionalHeaderOffset + optionalHeaderSize > buffer.length) {
		throw new Error("Truncated PE optional header");
	}
	const magic = buffer.readUInt16LE(optionalHeaderOffset);
	const directoryOffset =
		magic === 0x20b ? 112 : magic === 0x10b ? 96 : undefined;
	if (directoryOffset === undefined)
		throw new Error("Unsupported PE optional header");
	if (directoryOffset + 16 > optionalHeaderSize)
		throw new Error("Missing PE import directory");
	const importRva = buffer.readUInt32LE(
		optionalHeaderOffset + directoryOffset + 8,
	);
	const sectionTableOffset = optionalHeaderOffset + optionalHeaderSize;
	if (sectionTableOffset + sectionCount * 40 > buffer.length) {
		throw new Error("Truncated PE section table");
	}

	function rvaToOffset(rva) {
		for (let index = 0; index < sectionCount; index += 1) {
			const sectionOffset = sectionTableOffset + index * 40;
			const virtualSize = buffer.readUInt32LE(sectionOffset + 8);
			const virtualAddress = buffer.readUInt32LE(sectionOffset + 12);
			const rawSize = buffer.readUInt32LE(sectionOffset + 16);
			const rawOffset = buffer.readUInt32LE(sectionOffset + 20);
			const size = Math.max(virtualSize, rawSize);
			if (rva >= virtualAddress && rva < virtualAddress + size) {
				return rawOffset + rva - virtualAddress;
			}
		}
		throw new Error(`PE RVA is outside sections: 0x${rva.toString(16)}`);
	}

	const imports = [];
	if (importRva !== 0) {
		let descriptorOffset = rvaToOffset(importRva);
		while (descriptorOffset + 20 <= buffer.length) {
			const nameRva = buffer.readUInt32LE(descriptorOffset + 12);
			if (nameRva === 0) break;
			imports.push(readAscii(buffer, rvaToOffset(nameRva)));
			descriptorOffset += 20;
		}
	}
	return { architecture, imports: imports.sort() };
}

function copyBuildOutputs(targetDirectory, target, artifactDirectory) {
	const releaseDirectory = path.join(targetDirectory, target, "release");
	const outputs = [
		["acl-prototype-helper.exe", "acl-helper.exe"],
		["acl_prototype_addon.dll", "acl.node"],
	];
	fs.mkdirSync(artifactDirectory, { recursive: true });
	return outputs.map(([sourceName, destinationName]) => {
		const source = path.join(releaseDirectory, sourceName);
		if (!fs.statSync(source, { throwIfNoEntry: false })?.isFile()) {
			throw new Error(`Missing Cargo release output: ${source}`);
		}
		const destination = path.join(artifactDirectory, destinationName);
		fs.copyFileSync(source, destination);
		const contents = fs.readFileSync(destination);
		return {
			name: destinationName,
			bytes: contents.length,
			pe: parsePortableExecutable(contents),
		};
	});
}

function run(command, args, options) {
	childProcess.execFileSync(command, args, { ...options, stdio: "inherit" });
}

function commandOutput(command, args, options) {
	return childProcess
		.execFileSync(command, args, {
			...options,
			encoding: "utf8",
		})
		.trim();
}

function sourceRevision(root) {
	return commandOutput("git", ["rev-parse", "HEAD"], { cwd: root });
}

function vitestEntrypoint() {
	return path.join(
		path.dirname(require.resolve("vitest/package.json")),
		"vitest.mjs",
	);
}

function electron37Path(value = process.env.ACL_ELECTRON37_PATH) {
	if (!value || !path.isAbsolute(value)) {
		throw new Error(
			"ACL_ELECTRON37_PATH must be an absolute Electron 37 executable path",
		);
	}
	if (!fs.statSync(value, { throwIfNoEntry: false })?.isFile()) {
		throw new Error(`ACL_ELECTRON37_PATH is not an executable file: ${value}`);
	}
	return value;
}

function runtimeTest(root) {
	const vitest = vitestEntrypoint();
	const args = [
		vitest,
		"run",
		"--config",
		path.join(root, "test", "vitest.config.mts"),
	];
	const environment = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
	for (const runtime of [
		{ name: "node", command: process.execPath, args },
		{ name: "electron-current", command: require("electron"), args },
		{
			name: "electron-37",
			command: electron37Path(),
			args,
		},
	]) {
		run(runtime.command, runtime.args, { cwd: root, env: environment });
	}
	return ["node", "electron-current", "electron-37"];
}

function reportFilename(arch) {
	return `report-${arch}.json`;
}

function writeJson(filename, value) {
	fs.mkdirSync(path.dirname(filename), { recursive: true });
	fs.writeFileSync(filename, `${JSON.stringify(value, null, "\t")}\n`);
}

function runExperiment(target, options = {}) {
	const root = options.root ?? ROOT;
	const artifactRoot = options.artifactRoot ?? ARTIFACT_ROOT;
	const configuredBaselineRoot =
		options.baselineRoot ?? process.env.ACL_BASELINE_ROOT;
	const arch = WINDOWS_TARGETS.get(target);
	if (!arch) throw new Error(`Unsupported Rust target: ${target}`);
	if (process.platform !== "win32" || process.arch !== arch) {
		throw new Error(
			`Experiment target ${target} requires win32/${arch}; received ${process.platform}/${process.arch}`,
		);
	}
	const results = [];
	const failures = [];
	const toolchain = {
		cargo: commandOutput("cargo", ["+1.98.1", "--version"], { cwd: root }),
		rustc: commandOutput("rustc", ["+1.98.1", "--version"], { cwd: root }),
	};

	for (const cell of CELLS) {
		const cellRoot = path.join(artifactRoot, "experiments", cell.name);
		const artifactDirectory = path.join(cellRoot, `win32-${arch}`);
		let sourceRoot;
		let targetDirectory;
		try {
			sourceRoot = sourceRootFor(cell, root, configuredBaselineRoot);
			targetDirectory = path.join(
				sourceRoot,
				"target",
				"experiments",
				cell.name,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const report = {
				cell,
				target,
				arch,
				build: { targetDirectory, status: "failed" },
				runtimeTest: { status: "failed" },
				failure: message,
			};
			writeJson(path.join(cellRoot, reportFilename(arch)), report);
			results.push(report);
			failures.push(`${cell.name}: ${message}`);
			continue;
		}
		const report = {
			cell,
			target,
			arch,
			sourceRevision: sourceRevision(sourceRoot),
			toolchain,
			runtime: {
				execPath: process.execPath,
				platform: process.platform,
				arch: process.arch,
				versions: process.versions,
			},
			build: { targetDirectory, status: "pending" },
			runtimeTest: { status: "pending", runners: [] },
		};
		try {
			fs.rmSync(targetDirectory, { recursive: true, force: true });
			run(
				"cargo",
				[
					"+1.98.1",
					"build",
					"--release",
					"--workspace",
					"--target",
					target,
					"--manifest-path",
					path.join(sourceRoot, "Cargo.toml"),
					...(cell.features ? ["--features", cell.features.join(",")] : []),
					"--locked",
				],
				{
					cwd: sourceRoot,
					env: buildEnvironment(target, cell, targetDirectory),
				},
			);
			report.build = {
				status: "passed",
				targetDirectory,
				binaries: copyBuildOutputs(targetDirectory, target, artifactDirectory),
			};
			copyBuildOutputs(
				targetDirectory,
				target,
				path.join(artifactRoot, `win32-${arch}`),
			);
			report.runtimeTest = { status: "passed", runners: runtimeTest(root) };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			report.failure = message;
			if (report.build.status === "pending") report.build.status = "failed";
			if (report.runtimeTest.status === "pending")
				report.runtimeTest.status = "failed";
			failures.push(`${cell.name}: ${message}`);
		} finally {
			writeJson(path.join(cellRoot, reportFilename(arch)), report);
			results.push(report);
		}
	}
	if (failures.length > 0) throw new Error(failures.join("\n"));
	return results;
}

function main() {
	runExperiment(parseArguments(process.argv.slice(2)));
}

if (require.main === module) {
	try {
		main();
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}

module.exports = {
	ARTIFACT_ROOT,
	BASELINE_REVISION,
	CELLS,
	EXPERIMENT_ROOT,
	WINDOWS_TARGETS,
	baselineRoot,
	buildEnvironment,
	copyBuildOutputs,
	parseArguments,
	parsePortableExecutable,
	electron37Path,
	reportFilename,
	runExperiment,
	runtimeTest,
	sourceRootFor,
	targetEnvironmentName,
	vitestEntrypoint,
};
