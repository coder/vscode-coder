#!/usr/bin/env node
"use strict";
/* global __dirname, console, process */

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const ARTIFACT_ROOT = path.join(ROOT, "artifacts");
const VSCE = require.resolve("@vscode/vsce/vsce");
const VARIANTS = new Set(["helper", "addon"]);
const WINDOWS_ARCHITECTURES = ["x64", "arm64"];

function parseArguments(args) {
	if (args.length !== 1 || !VARIANTS.has(args[0])) {
		throw new Error("Usage: package-prototype.cjs <helper|addon>");
	}
	return args[0];
}

function copyRequiredFile(source, destination) {
	if (!fs.statSync(source, { throwIfNoEntry: false })?.isFile()) {
		throw new Error(`Missing required prototype file: ${source}`);
	}
	fs.mkdirSync(path.dirname(destination), { recursive: true });
	fs.copyFileSync(source, destination);
}

function packageManifest(variant) {
	return {
		name: `windows-acl-prototype-${variant}`,
		displayName: `Windows ACL Prototype (${variant})`,
		version: "0.0.0",
		publisher: "coder-prototype",
		description: "Experimental Windows ACL packaging prototype.",
		engines: { vscode: "^1.105.0" },
		main: "./extension.cjs",
		activationEvents: [],
	};
}

function assemble(variant, { root = ROOT, artifactRoot = ARTIFACT_ROOT } = {}) {
	if (!VARIANTS.has(variant))
		throw new Error(`Unknown ACL prototype: ${variant}`);

	const assemblyDirectory = path.join(artifactRoot, `vsix-${variant}`);
	fs.rmSync(assemblyDirectory, { recursive: true, force: true });
	fs.mkdirSync(assemblyDirectory, { recursive: true });

	copyRequiredFile(
		path.join(root, "bridge.cjs"),
		path.join(assemblyDirectory, "bridge.cjs"),
	);
	fs.writeFileSync(
		path.join(assemblyDirectory, "extension.cjs"),
		"exports.activate = () => {};\nexports.deactivate = () => {};\n",
	);
	fs.writeFileSync(
		path.join(assemblyDirectory, "package.json"),
		`${JSON.stringify(packageManifest(variant), null, "\t")}\n`,
	);

	const nativeName = variant === "helper" ? "acl-helper.exe" : "acl.node";
	for (const arch of WINDOWS_ARCHITECTURES) {
		copyRequiredFile(
			path.join(artifactRoot, `win32-${arch}`, nativeName),
			path.join(assemblyDirectory, "artifacts", `win32-${arch}`, nativeName),
		);
	}
	return assemblyDirectory;
}

function packagePrototype(variant, options = {}) {
	const root = options.root ?? ROOT;
	const artifactRoot = options.artifactRoot ?? ARTIFACT_ROOT;
	const vsce = options.vsce ?? VSCE;
	const assemblyDirectory = assemble(variant, { root, artifactRoot });
	if (!fs.statSync(vsce, { throwIfNoEntry: false })?.isFile()) {
		throw new Error(`VS Code packaging executable is unavailable: ${vsce}`);
	}

	const output = path.join(
		artifactRoot,
		`windows-acl-prototype-${variant}-0.0.0.vsix`,
	);
	fs.rmSync(output, { force: true });
	childProcess.execFileSync(
		process.execPath,
		[
			vsce,
			"package",
			"--no-dependencies",
			"--allow-missing-repository",
			"--skip-license",
			"--out",
			output,
		],
		{
			cwd: assemblyDirectory,
			stdio: "inherit",
		},
	);
	return output;
}

function main() {
	console.log(packagePrototype(parseArguments(process.argv.slice(2))));
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
	VARIANTS,
	WINDOWS_ARCHITECTURES,
	assemble,
	packageManifest,
	packagePrototype,
	parseArguments,
};
