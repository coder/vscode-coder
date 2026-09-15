import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { WindowsAcl } from "@/remote/windowsAcl";

interface CommandResult {
	stdout: string;
	stderr: string;
}

const { execute } = vi.hoisted(() => ({
	execute:
		vi.fn<
			(
				command: string,
				args: string[],
				options: unknown,
			) => Promise<CommandResult>
		>(),
}));

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	const { promisify } = await import("node:util");
	return {
		...actual,
		execFile: Object.assign(vi.fn(), { [promisify.custom]: execute }),
	};
});

const sid = "S-1-5-21-1-2-3-1001";
const scriptPath = "C:\\Program Files\\Coder\\secure-acl.js";
const protectedDacl = `D:PAI(A;;FA;;;${sid})(A;;FA;;;SY)(A;;FA;;;BA)S:AI`;
const emptyResult: CommandResult = { stdout: "", stderr: "" };
const commandArgs = [
	["/user", "/fo", "csv", "/nh"],
	["/inheritancelevel:d"],
	["//nologo", "//B", "//E:JScript", scriptPath, undefined, sid],
	["/save", undefined],
] as const;

const test = it
	.extend("file", async ({ task: _task }, { onCleanup }) => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "coder-acl-test-"));
		const target = path.join(root, "file.conf");
		await fs.writeFile(target, "");
		onCleanup(async () => {
			await fs.rm(root, { recursive: true, force: true });
		});
		return target;
	})
	.extend("execute", ({ task: _task }, { onCleanup }) => {
		execute.mockReset();
		onCleanup(() => {
			execute.mockReset();
		});
		return execute;
	});

function whoamiResult(accountSid = sid): CommandResult {
	return { stdout: `"S-1-5-21-9-9-9-9999","${accountSid}"`, stderr: "" };
}

async function saveDescriptor(args: string[]): Promise<CommandResult> {
	const backup = args[2];
	if (typeof backup !== "string")
		throw new Error("Expected an ACL backup path");
	await fs.writeFile(
		backup,
		`\uFEFFfile.conf\r\n${protectedDacl}\r\n`,
		"utf16le",
	);
	return emptyResult;
}

describe("WindowsAcl", () => {
	it("rejects invalid paths", async () => {
		await expect(
			new WindowsAcl(scriptPath).secure("not a Windows path"),
		).rejects.toThrow("Could not repair SSH config permissions");
	});

	describe.runIf(process.platform === "win32")("on Windows", () => {
		test("runs the expected commands in order and removes its ACL backup", async ({
			file,
			execute,
		}) => {
			let backup: string | undefined;
			execute
				.mockResolvedValueOnce(whoamiResult())
				.mockResolvedValueOnce(emptyResult)
				.mockResolvedValueOnce(emptyResult)
				.mockImplementationOnce(async (_command, args) => {
					backup = args[2];
					return saveDescriptor(args);
				});
			const mixedTarget = `${path.dirname(file)}/${path.basename(file)}`;

			await new WindowsAcl(scriptPath).secure(mixedTarget);

			const normalizedTarget = path.win32.normalize(mixedTarget);
			expect(execute.mock.calls.map(([, args]) => args)).toEqual([
				commandArgs[0],
				[normalizedTarget, ...commandArgs[1]],
				[...commandArgs[2].slice(0, 4), normalizedTarget, sid],
				[normalizedTarget, "/save", backup],
			]);
			expect(backup).toBeTypeOf("string");
			await expect(fs.access(backup!)).rejects.toMatchObject({
				code: "ENOENT",
			});
		});

		for (const [name, failureCall] of [
			["whoami", 1],
			["protect", 2],
			["script", 3],
			["save", 4],
		] as const) {
			test(`stops after a ${name} failure`, async ({ file, execute }) => {
				const cause = new Error(`${name} failed`);
				for (let call = 1; call < failureCall; call++) {
					execute.mockResolvedValueOnce(
						call === 1 ? whoamiResult() : emptyResult,
					);
				}
				execute.mockRejectedValueOnce(cause);

				await expect(
					new WindowsAcl(scriptPath).secure(file),
				).rejects.toMatchObject({
					message: `Could not repair SSH config permissions for ${file}: ${cause.message}`,
					cause,
				});
				expect(execute).toHaveBeenCalledTimes(failureCall);
			});
		}

		test("removes the ACL backup when reading it fails", async ({
			file,
			execute,
		}) => {
			let backup: string | undefined;
			execute
				.mockResolvedValueOnce(whoamiResult())
				.mockResolvedValueOnce(emptyResult)
				.mockResolvedValueOnce(emptyResult)
				.mockImplementationOnce((_command, args) => {
					backup = args[2];
					return Promise.resolve(emptyResult);
				});

			await expect(new WindowsAcl(scriptPath).secure(file)).rejects.toThrow();
			expect(backup).toBeTypeOf("string");
			await expect(fs.access(backup!)).rejects.toMatchObject({
				code: "ENOENT",
			});
		});
	});
});
