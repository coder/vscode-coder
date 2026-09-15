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
const aclErrors = {
	format: "Unexpected Windows ACL backup format",
	permissions:
		"Windows ACL does not contain only the expected protected permissions",
} as const;

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

function mockSuccessfulSetup(accountSid = sid, commandCount = 3): void {
	const results: CommandResult[] = [
		{ stdout: `"S-1-5-21-9-9-9-9999","${accountSid}"`, stderr: "" },
		emptyResult,
		emptyResult,
	];
	for (const result of results.slice(0, commandCount)) {
		execute.mockResolvedValueOnce(result);
	}
}

async function writeSavedDacl(
	args: string[],
	dacl: string,
): Promise<CommandResult> {
	const backup = args[2];
	if (typeof backup !== "string") {
		throw new Error("Expected an ACL backup path");
	}
	await fs.writeFile(backup, `\uFEFFfile.conf\r\n${dacl}\r\n`, "utf16le");
	return emptyResult;
}

describe("WindowsAcl", () => {
	test.runIf(process.platform !== "win32")(
		"does nothing outside Windows",
		async ({ execute }) => {
			await new WindowsAcl(scriptPath).secure("not a Windows path");
			expect(execute).not.toHaveBeenCalled();
		},
	);

	describe.runIf(process.platform === "win32")("on Windows", () => {
		test("uses the final CSV SID and separates script arguments", async ({
			file,
			execute,
		}) => {
			mockSuccessfulSetup();
			execute.mockImplementationOnce((_command, args) =>
				writeSavedDacl(args, protectedDacl),
			);

			await new WindowsAcl(scriptPath).secure(
				`${path.dirname(file)}/${path.basename(file)}`,
			);

			expect(execute.mock.calls[1]?.[1]).toEqual([file, "/inheritancelevel:d"]);
			expect(execute.mock.calls[2]?.[1]).toEqual([
				"//nologo",
				"//B",
				"//E:JScript",
				scriptPath,
				file,
				sid,
			]);
			expect(execute.mock.calls[3]?.[1]?.[2]).toBeTypeOf("string");
		});

		for (const [accountSid, trustee, succeeds] of [
			["S-1-5-21-1-2-3-500", "LA", true],
			["S-1-5-21-1-2-3-501", "LG", true],
			[sid, "LA", false],
		] as const) {
			test(`checks ${trustee} against current account ${accountSid}`, async ({
				file,
				execute,
			}) => {
				mockSuccessfulSetup(accountSid);
				execute.mockImplementationOnce((_command, args) =>
					writeSavedDacl(
						args,
						`D:PAI(A;;FA;;;${trustee})(A;;FA;;;SY)(A;;FA;;;BA)`,
					),
				);
				const repair = new WindowsAcl(scriptPath).secure(file);
				if (succeeds) await expect(repair).resolves.toBeUndefined();
				else
					await expect(repair).rejects.toThrow(
						"expected protected permissions",
					);
			});
		}

		test("fails before mutation for a malformed current SID", async ({
			file,
			execute,
		}) => {
			execute.mockResolvedValueOnce({
				stdout: '"account","S-1-invalid"',
				stderr: "",
			});

			await expect(new WindowsAcl(scriptPath).secure(file)).rejects.toThrow(
				"Could not read the current Windows user SID",
			);

			expect(execute).toHaveBeenCalledTimes(1);
		});

		for (const [name, failureCall] of [
			["protect", 2],
			["script", 3],
			["save", 4],
		] as const) {
			test(`preserves a ${name} failure and does not run later subprocesses`, async ({
				file,
				execute,
			}) => {
				const cause = new Error(`${name} failed`);
				mockSuccessfulSetup(sid, failureCall - 1);
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

		for (const [name, backupDacl, error] of [
			["a malformed backup", "D:P\r\nextra entry", aclErrors.format],
			[
				"an unprotected DACL",
				`D:(A;;FA;;;${sid})(A;;FA;;;SY)(A;;FA;;;BA)`,
				aclErrors.permissions,
			],
			[
				"an extra Everyone ACE",
				`D:P(A;;FA;;;${sid})(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;WD)`,
				aclErrors.permissions,
			],
			[
				"a deny ACE",
				`D:P(D;;FA;;;WD)(A;;FA;;;${sid})(A;;FA;;;SY)(A;;FA;;;BA)`,
				aclErrors.permissions,
			],
			[
				"an inherited ACE",
				`D:P(A;OICI;FA;;;${sid})(A;;FA;;;SY)(A;;FA;;;BA)`,
				aclErrors.permissions,
			],
			[
				"a missing user ACE",
				"D:P(A;;FA;;;SY)(A;;FA;;;BA)",
				aclErrors.permissions,
			],
		] as const) {
			test(`fails closed for ${name} and cleans up the saved ACL`, async ({
				file,
				execute,
			}) => {
				let backup: string | undefined;
				mockSuccessfulSetup();
				execute.mockImplementationOnce(
					async (_command: string, args: string[]) => {
						backup = args[2];
						return writeSavedDacl(args, backupDacl);
					},
				);

				await expect(new WindowsAcl(scriptPath).secure(file)).rejects.toThrow(
					error,
				);

				expect(execute).toHaveBeenCalledTimes(4);
				expect(backup).toBeTypeOf("string");
				await expect(fs.access(backup!)).rejects.toMatchObject({
					code: "ENOENT",
				});
			});
		}
	});
});
