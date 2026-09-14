import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import packageModule from "../package-prototype.cjs";

const { assemble, packageManifest, packagePrototype, parseArguments } =
	packageModule;
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), "windows-acl-package-"),
	);
	temporaryDirectories.push(directory);
	return directory;
}

function writeArtifact(
	artifactRoot: string,
	arch: "x64" | "arm64",
	name: "acl-helper.exe" | "acl.node",
	contents: string = name,
): void {
	const directory = path.join(artifactRoot, `win32-${arch}`);
	fs.mkdirSync(directory, { recursive: true });
	fs.writeFileSync(path.join(directory, name), contents);
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

describe("package-prototype", () => {
	it("requires exactly one known prototype variant", () => {
		expect(parseArguments(["helper"])).toBe("helper");
		expect(() => parseArguments([])).toThrow("Usage:");
		expect(() => parseArguments(["helper", "addon"])).toThrow("Usage:");
		expect(() => parseArguments(["unknown"])).toThrow("Usage:");
	});

	it("generates an independent inert extension manifest", () => {
		expect(packageManifest("helper")).toMatchObject({
			name: "windows-acl-prototype-helper",
			publisher: "coder-prototype",
			main: "./extension.cjs",
			activationEvents: [],
		});
		expect(packageManifest("helper").name).not.toBe("coder-remote");
	});

	it("assembles only bridge code and the selected Windows helper binaries", () => {
		const root = temporaryDirectory();
		const artifactRoot = path.join(root, "artifacts");
		fs.writeFileSync(path.join(root, "bridge.cjs"), "module.exports = {};\n");
		for (const arch of ["x64", "arm64"] as const) {
			writeArtifact(artifactRoot, arch, "acl-helper.exe", `${arch}-helper`);
			writeArtifact(artifactRoot, arch, "acl.node", `${arch}-addon`);
		}
		fs.mkdirSync(path.join(artifactRoot, "linux-x64"), { recursive: true });
		fs.writeFileSync(
			path.join(artifactRoot, "linux-x64", "acl-helper"),
			"linux",
		);

		const assembly = assemble("helper", { root, artifactRoot });

		expect(fs.readFileSync(path.join(assembly, "bridge.cjs"), "utf8")).toBe(
			"module.exports = {};\n",
		);
		expect(
			fs.readFileSync(
				path.join(assembly, "artifacts", "win32-x64", "acl-helper.exe"),
				"utf8",
			),
		).toBe("x64-helper");
		expect(
			fs.readFileSync(
				path.join(assembly, "artifacts", "win32-arm64", "acl-helper.exe"),
				"utf8",
			),
		).toBe("arm64-helper");
		expect(fs.existsSync(path.join(assembly, "artifacts", "linux-x64"))).toBe(
			false,
		);
		expect(
			fs.existsSync(path.join(assembly, "artifacts", "win32-x64", "acl.node")),
		).toBe(false);
		expect(
			fs.readFileSync(path.join(assembly, "extension.cjs"), "utf8"),
		).toContain("exports.activate = () => {};");
	});

	it("fails before packaging when the selected universal Windows payload is incomplete", () => {
		const root = temporaryDirectory();
		const artifactRoot = path.join(root, "artifacts");
		fs.writeFileSync(path.join(root, "bridge.cjs"), "module.exports = {};\n");
		writeArtifact(artifactRoot, "x64", "acl.node");

		expect(() => assemble("addon", { root, artifactRoot })).toThrow(
			"Missing required prototype file",
		);
	});
});

const projectRoot = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const realArtifactRoot = path.join(
	projectRoot,
	"prototypes",
	"windows-acl",
	"artifacts",
);
const variants = ["helper", "addon"] as const;
const stagedVariants = variants.filter((variant) => {
	const name = variant === "helper" ? "acl-helper.exe" : "acl.node";
	return ["x64", "arm64"].every((arch) =>
		fs
			.statSync(path.join(realArtifactRoot, `win32-${arch}`, name), {
				throwIfNoEntry: false,
			})
			?.isFile(),
	);
});

describe.runIf(stagedVariants.length === 2)("universal VSIX archives", () => {
	it.each(variants)(
		"packages the real staged %s payload with the expected manifest and contents",
		(variant) => {
			const output = packagePrototype(variant);
			const listing = childProcess.execFileSync("unzip", ["-Z1", output], {
				encoding: "utf8",
			});
			const entries = listing.split(/\r?\n/).filter(Boolean);
			const manifest = childProcess.execFileSync(
				"unzip",
				["-p", output, "extension/package.json"],
				{ encoding: "utf8" },
			);

			expect(JSON.parse(manifest)).toMatchObject(packageManifest(variant));
			expect(entries).toEqual(
				expect.arrayContaining([
					"extension/bridge.cjs",
					"extension/extension.cjs",
					"extension/artifacts/win32-x64/" +
						(variant === "helper" ? "acl-helper.exe" : "acl.node"),
					"extension/artifacts/win32-arm64/" +
						(variant === "helper" ? "acl-helper.exe" : "acl.node"),
				]),
			);
			expect(entries.some((entry) => entry.includes("linux-"))).toBe(false);
		},
	);
});
