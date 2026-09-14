#!/usr/bin/env node
"use strict";
/* global __dirname, console, process */

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
	BASELINE_REVISION,
	CELLS,
	reportFilename,
} = require("./experiment.cjs");
const {
	packageManifest,
	packagePrototype,
} = require("./package-prototype.cjs");

const ROOT = __dirname;
const ARTIFACT_ROOT = path.join(ROOT, "artifacts");
const ARCHITECTURES = ["x64", "arm64"];
const VARIANTS = ["helper", "addon"];

function fileSize(filename) {
	const stat = fs.statSync(filename, { throwIfNoEntry: false });
	if (!stat?.isFile())
		throw new Error(`Missing experiment artifact: ${filename}`);
	return stat.size;
}

function readJson(filename) {
	try {
		return JSON.parse(fs.readFileSync(filename, "utf8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid experiment report ${filename}: ${message}`, {
			cause: error,
		});
	}
}

function verifyPackage(filename, variant) {
	const entries = childProcess
		.execFileSync("unzip", ["-Z1", filename], { encoding: "utf8" })
		.split(/\r?\n/)
		.filter(Boolean);
	const manifest = JSON.parse(
		childProcess.execFileSync(
			"unzip",
			["-p", filename, "extension/package.json"],
			{
				encoding: "utf8",
			},
		),
	);
	for (const arch of ARCHITECTURES) {
		const name = variant === "helper" ? "acl-helper.exe" : "acl.node";
		const entry = `extension/artifacts/win32-${arch}/${name}`;
		if (!entries.includes(entry))
			throw new Error(`Package ${filename} is missing ${entry}`);
	}
	if (entries.some((entry) => entry.includes("linux-"))) {
		throw new Error(`Package ${filename} includes a non-Windows artifact`);
	}
	if (JSON.stringify(manifest) === "{}") {
		throw new Error(`Package ${filename} has an empty manifest`);
	}
	const expected = packageManifest(variant);
	if (manifest.name !== expected.name || manifest.main !== expected.main) {
		throw new Error(`Package ${filename} has an unexpected manifest`);
	}
}

function collectCell(cell, { root = ROOT, artifactRoot = ARTIFACT_ROOT } = {}) {
	const cellRoot = path.join(artifactRoot, "experiments", cell.name);
	const architectures = {};
	for (const arch of ARCHITECTURES) {
		const artifactDirectory = path.join(cellRoot, `win32-${arch}`);
		const report = readJson(path.join(cellRoot, reportFilename(arch)));
		if (report.arch !== arch || report.cell?.name !== cell.name) {
			throw new Error(`Experiment report does not match ${cell.name}/${arch}`);
		}
		if (
			report.build?.status !== "passed" ||
			report.runtimeTest?.status !== "passed"
		) {
			throw new Error(
				`Experiment ${cell.name}/${arch} failed: ${report.failure ?? "unknown failure"}`,
			);
		}
		architectures[arch] = {
			report,
			helperBytes: fileSize(path.join(artifactDirectory, "acl-helper.exe")),
			addonBytes: fileSize(path.join(artifactDirectory, "acl.node")),
		};
	}
	const packages = {};
	for (const variant of VARIANTS) {
		const output = packagePrototype(variant, { root, artifactRoot: cellRoot });
		verifyPackage(output, variant);
		packages[variant] = { bytes: fileSize(output) };
	}
	return { architectures, packages };
}

function createExperimentReport(options = {}) {
	const root = options.root ?? ROOT;
	const artifactRoot = options.artifactRoot ?? ARTIFACT_ROOT;
	const cells = Object.fromEntries(
		CELLS.map((cell) => [cell.name, collectCell(cell, { root, artifactRoot })]),
	);
	const report = {
		generatedAt: new Date().toISOString(),
		baselineRevision: BASELINE_REVISION,
		cells,
	};
	const output = path.join(artifactRoot, "experiments", "report.json");
	fs.mkdirSync(path.dirname(output), { recursive: true });
	fs.writeFileSync(output, `${JSON.stringify(report, null, "\t")}\n`);
	return { output, report };
}

function main() {
	console.log(createExperimentReport().output);
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
	ARCHITECTURES,
	VARIANTS,
	collectCell,
	createExperimentReport,
	verifyPackage,
};
