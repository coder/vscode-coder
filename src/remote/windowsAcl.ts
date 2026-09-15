import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** Repairs managed file DACLs without changing directory permissions or owners. */
export class WindowsAcl {
	constructor(private readonly scriptPath: string) {}

	async secure(target: string): Promise<void> {
		if (process.platform !== "win32") return;
		try {
			await this.validateFile(target);
			target = path.win32.normalize(target);
			const sid = await this.currentUserSid();
			await this.run("icacls.exe", [target, "/inheritancelevel:d"]);
			await this.run("cscript.exe", [
				"//nologo",
				"//B",
				"//E:JScript",
				this.scriptPath,
				target,
				sid,
			]);
			await this.verifyFileAcl(target, sid);
		} catch (error) {
			throw new Error(
				`Could not repair SSH config permissions for ${target}: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			);
		}
	}

	private async validateFile(target: string): Promise<void> {
		if (!path.win32.isAbsolute(target) || /[\0\r\n*?]/.test(target)) {
			throw new Error(
				"Expected an absolute file path without wildcards or control characters",
			);
		}
		const stat = await fs.lstat(target);
		if (!stat.isFile() || stat.nlink !== 1) {
			throw new Error("Expected a regular file with no links");
		}
	}

	private async currentUserSid(): Promise<string> {
		const { stdout } = await this.run("whoami.exe", [
			"/user",
			"/fo",
			"csv",
			"/nh",
		]);
		const sid = /,"(S-\d+(?:-\d+)+)"\s*$/.exec(stdout)?.[1];
		if (!sid) throw new Error("Could not read the current Windows user SID");
		return sid;
	}

	private async readFileAcl(target: string): Promise<string> {
		const directory = await fs.mkdtemp(
			path.join(os.tmpdir(), "coder-ssh-acl-"),
		);
		try {
			const backup = path.join(directory, "acl.txt");
			await this.run("icacls.exe", [target, "/save", backup]);
			const saved = (await fs.readFile(backup, "utf16le"))
				.replace(/^\uFEFF/, "")
				.trimEnd();
			const [name, descriptor, ...extra] = saved.split(/\r?\n/);
			if (
				name !== path.win32.basename(target) ||
				extra.length !== 0 ||
				!descriptor
			) {
				throw new Error("Unexpected Windows ACL backup format");
			}
			return descriptor;
		} finally {
			await fs.rm(directory, { recursive: true, force: true });
		}
	}

	private async verifyFileAcl(target: string, sid: string): Promise<void> {
		const descriptor = await this.readFileAcl(target);
		const aces =
			/^D:P(?:AI)?((?:\(A;;FA;;;[A-Z0-9-]+\)){3})(?:S:P?(?:AI)?)?$/.exec(
				descriptor,
			)?.[1];
		const trustees = aces
			? [...aces.matchAll(/\(A;;FA;;;([A-Z0-9-]+)\)/g)].map((ace) => ace[1])
			: [];
		// SDDL abbreviates the built-in Administrator and Guest account SIDs.
		const accountAlias = sid.replace(
			/^S-1-5-21-\d+-\d+-\d+-(500|501)$/,
			(_match, id: string) => (id === "500" ? "LA" : "LG"),
		);
		const user = trustees.includes(sid) ? sid : accountAlias;
		const expected = [user, "SY", "BA"];
		if (
			trustees.length !== 3 ||
			!expected.every((trustee) => trustees.includes(trustee))
		) {
			throw new Error(
				"Windows ACL does not contain only the expected protected permissions",
			);
		}
	}

	private run(name: string, args: string[]) {
		const systemRoot = process.env.SystemRoot;
		if (!systemRoot || !path.win32.isAbsolute(systemRoot)) {
			throw new Error("SystemRoot must be an absolute Windows path");
		}
		return execute(path.join(systemRoot, "System32", name), args, {
			windowsHide: true,
			timeout: 10_000,
			maxBuffer: 64 * 1024,
			encoding: "utf8",
		});
	}
}
