import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import reportModule from "../experiment-report.cjs";

const { collectCell } = reportModule;
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
	const directory = fs.mkdtempSync(
		path.join(os.tmpdir(), "windows-acl-experiment-report-"),
	);
	temporaryDirectories.push(directory);
	return directory;
}

function writeCellReport(
	root: string,
	cell: string,
	arch: "x64" | "arm64",
): void {
	const directory = path.join(root, "experiments", cell, `win32-${arch}`);
	fs.mkdirSync(directory, { recursive: true });
	fs.writeFileSync(
		path.join(root, "experiments", cell, `report-${arch}.json`),
		JSON.stringify({
			cell: { name: cell },
			arch,
			build: { status: "passed" },
			runtimeTest: { status: "passed" },
		}),
	);
	fs.writeFileSync(path.join(directory, "acl-helper.exe"), "helper");
	fs.writeFileSync(path.join(directory, "acl.node"), "addon");
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

describe("experiment-report", () => {
	it("fails when an architecture payload is missing", () => {
		const artifactRoot = temporaryDirectory();
		writeCellReport(artifactRoot, "simplified-s", "x64");

		expect(() =>
			collectCell(
				{
					name: "simplified-s",
					source: "current",
					optLevel: "s",
					crtStatic: false,
				},
				{ artifactRoot },
			),
		).toThrow("Invalid experiment report");
	});

	it("fails explicitly when a recorded cell failed", () => {
		const artifactRoot = temporaryDirectory();
		for (const arch of ["x64", "arm64"] as const) {
			writeCellReport(artifactRoot, "simplified-s", arch);
		}
		const failed = path.join(
			artifactRoot,
			"experiments",
			"simplified-s",
			"report-arm64.json",
		);
		fs.writeFileSync(
			failed,
			JSON.stringify({
				cell: { name: "simplified-s" },
				arch: "arm64",
				build: { status: "failed" },
				runtimeTest: { status: "failed" },
				failure: "native build failed",
			}),
		);

		expect(() =>
			collectCell(
				{
					name: "simplified-s",
					source: "current",
					optLevel: "s",
					crtStatic: false,
				},
				{ artifactRoot },
			),
		).toThrow("Experiment simplified-s/arm64 failed: native build failed");
	});
});
