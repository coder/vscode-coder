import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import stageModule from "../stage.cjs";

const { parseArguments, stage } = stageModule;
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), "windows-acl-stage-"),
	);
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

describe("stage", () => {
	it("accepts only an explicit supported Cargo target", () => {
		expect(parseArguments(["--target", "x86_64-pc-windows-msvc"])).toBe(
			"x86_64-pc-windows-msvc",
		);
		expect(() => parseArguments([])).toThrow("--target is required");
		expect(() =>
			parseArguments(["--target", "mipsel-unknown-linux-gnu"]),
		).toThrow("Unsupported Rust target");
	});

	it("copies Windows helper and addon Cargo outputs into a matching artifact directory", () => {
		const root = temporaryDirectory();
		const artifactRoot = path.join(root, "artifacts");
		const release = path.join(
			root,
			"target",
			"x86_64-pc-windows-msvc",
			"release",
		);
		fs.mkdirSync(release, { recursive: true });
		fs.writeFileSync(path.join(release, "acl-prototype-helper.exe"), "helper");
		fs.writeFileSync(path.join(release, "acl_prototype_addon.dll"), "addon");

		const output = stage("x86_64-pc-windows-msvc", { root, artifactRoot });

		expect(output).toBe(path.join(artifactRoot, "win32-x64"));
		expect(fs.readFileSync(path.join(output, "acl-helper.exe"), "utf8")).toBe(
			"helper",
		);
		expect(fs.readFileSync(path.join(output, "acl.node"), "utf8")).toBe(
			"addon",
		);
	});

	it("stages Linux outputs for transport probes without renaming them as Windows products", () => {
		const root = temporaryDirectory();
		const artifactRoot = path.join(root, "artifacts");
		const release = path.join(
			root,
			"target",
			"x86_64-unknown-linux-gnu",
			"release",
		);
		fs.mkdirSync(release, { recursive: true });
		fs.writeFileSync(path.join(release, "acl-prototype-helper"), "helper");
		fs.writeFileSync(path.join(release, "libacl_prototype_addon.so"), "addon");

		const output = stage("x86_64-unknown-linux-gnu", { root, artifactRoot });

		expect(output).toBe(path.join(artifactRoot, "linux-x64"));
		expect(fs.existsSync(path.join(output, "acl-helper"))).toBe(true);
		expect(fs.existsSync(path.join(output, "acl.node"))).toBe(true);
		expect(fs.existsSync(path.join(artifactRoot, "win32-x64"))).toBe(false);
	});

	it("fails strictly when any Cargo release output is missing", () => {
		const root = temporaryDirectory();
		const release = path.join(
			root,
			"target",
			"aarch64-pc-windows-msvc",
			"release",
		);
		fs.mkdirSync(release, { recursive: true });
		fs.writeFileSync(path.join(release, "acl-prototype-helper.exe"), "helper");

		expect(() =>
			stage("aarch64-pc-windows-msvc", {
				root,
				artifactRoot: path.join(root, "artifacts"),
			}),
		).toThrow("Missing Cargo release output");
	});
});
