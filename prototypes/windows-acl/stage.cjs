#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const ARTIFACT_ROOT = path.join(ROOT, "artifacts");

const TARGETS = new Map([
	["x86_64-pc-windows-msvc", { platform: "win32", arch: "x64" }],
	["aarch64-pc-windows-msvc", { platform: "win32", arch: "arm64" }],
	["x86_64-unknown-linux-gnu", { platform: "linux", arch: "x64" }],
	["aarch64-unknown-linux-gnu", { platform: "linux", arch: "arm64" }],
]);

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
	if (!TARGETS.has(target))
		throw new Error(`Unsupported Rust target: ${target}`);
	return target;
}

function nativeOutputs(platform) {
	return platform === "win32"
		? [
				["acl-prototype-helper.exe", "acl-helper.exe"],
				["acl_prototype_addon.dll", "acl.node"],
			]
		: [
				["acl-prototype-helper", "acl-helper"],
				["libacl_prototype_addon.so", "acl.node"],
			];
}

function stage(target, { root = ROOT, artifactRoot = ARTIFACT_ROOT } = {}) {
	const destination = TARGETS.get(target);
	if (!destination) throw new Error(`Unsupported Rust target: ${target}`);

	const releaseDirectory = path.join(root, "target", target, "release");
	const artifactDirectory = path.join(
		artifactRoot,
		`${destination.platform}-${destination.arch}`,
	);
	fs.mkdirSync(artifactDirectory, { recursive: true });

	for (const [sourceName, destinationName] of nativeOutputs(
		destination.platform,
	)) {
		const source = path.join(releaseDirectory, sourceName);
		if (!fs.statSync(source, { throwIfNoEntry: false })?.isFile()) {
			throw new Error(`Missing Cargo release output: ${source}`);
		}
		fs.copyFileSync(source, path.join(artifactDirectory, destinationName));
	}

	return artifactDirectory;
}

function main() {
	const target = parseArguments(process.argv.slice(2));
	console.log(stage(target));
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
	TARGETS,
	nativeOutputs,
	parseArguments,
	stage,
};
