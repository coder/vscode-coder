import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const [, , mode, root, phase = "cases"] = process.argv;
const system = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
const runner = path.join(root, "runner.exe");
const node = path.join(root, "node.exe");
const script = path.join(root, "acl-production-probe.mjs");
const workerTimeout = 10 * 60 * 1000;
const syntheticSid = "S-1-5-21-111111111-222222222-333333333-4444";
const systemSid = "S-1-5-18";
const administratorsSid = "S-1-5-32-544";

function run(executable, args, timeout = 30_000) {
	try {
		return {
			ok: true,
			status: 0,
			stdout: execFileSync(executable, args, {
				encoding: "utf8",
				windowsHide: true,
				timeout,
				maxBuffer: 2 * 1024 * 1024,
				stdio: ["ignore", "pipe", "pipe"],
			}).trim(),
			stderr: "",
		};
	} catch (error) {
		return {
			ok: false,
			status: error.status ?? null,
			code: error.code ?? null,
			signal: error.signal ?? null,
			stdout: String(error.stdout ?? "").trim(),
			stderr: String(error.stderr ?? "").trim(),
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

function must(executable, args, timeout) {
	const result = run(executable, args, timeout);
	if (!result.ok) throw new Error(JSON.stringify({ executable, args, result }));
	return result.stdout;
}

function writeJson(name, value) {
	fs.writeFileSync(path.join(root, name), JSON.stringify(value, null, 2));
}

function readJson(name) {
	return JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
}

function snapshot(target) {
	return must(runner, ["snapshot", target]);
}

function owner(target) {
	return must(runner, ["owner", target]);
}

function seed(target, descriptor) {
	must(runner, ["seed", target, descriptor]);
}

function numericSid(sid) {
	return `*${sid}`;
}

function trustedDescriptor(currentSid, extra = "") {
	return `D:P${extra}(A;;FA;;;${currentSid})(A;;FA;;;SY)(A;;FA;;;BA)`;
}

function hash(target) {
	return createHash("sha256").update(fs.readFileSync(target)).digest("hex");
}

function fileState(target) {
	const stat = fs.lstatSync(target);
	return {
		dev: stat.dev,
		ino: stat.ino,
		nlink: stat.nlink,
		size: stat.size,
		hash: hash(target),
		owner: owner(target),
		descriptor: snapshot(target),
	};
}

function dacl(descriptor) {
	return /D:(.*?)(?=S:|$)/.exec(descriptor)?.[1] ?? "";
}

function hasOnlyTrustedProtectedDacl(descriptor, currentSid) {
	const value = dacl(descriptor);
	if (!value.startsWith("P")) return false;
	const aces = [...value.matchAll(/\(([^)]*)\)/g)].map((match) =>
		match[1].split(";"),
	);
	const expected = new Set([currentSid, systemSid, administratorsSid]);
	if (aces.length !== expected.size) return false;
	const valid = aces.every(
		(ace) =>
			ace.length === 6 &&
			ace[0] === "A" &&
			ace[1] === "" &&
			ace[2] === "FA" &&
			expected.delete(
				{ SY: systemSid, BA: administratorsSid }[ace[5]] ?? ace[5],
			),
	);
	return valid && expected.size === 0;
}

function openSsh(main) {
	const result = run(path.join(system, "OpenSSH", "ssh.exe"), [
		"-G",
		"-F",
		main,
		"current",
	]);
	return {
		...result,
		proxyCommand: result.stdout
			.split(/\r?\n/)
			.filter((line) => line.startsWith("proxycommand "))
			.join("\n"),
	};
}

function standardIdentity() {
	const whoami = must(path.join(system, "whoami.exe"), [
		"/user",
		"/fo",
		"csv",
		"/nh",
	]);
	const sid = /,"(S-\d+(?:-\d+)+)"\s*$/.exec(whoami)?.[1];
	if (!sid) throw new Error(`Could not parse user SID from ${whoami}`);
	const groups = must(path.join(system, "whoami.exe"), [
		"/groups",
		"/fo",
		"csv",
		"/nh",
	]);
	return {
		sid,
		whoami,
		groups,
		isStandardUser: !groups.includes(administratorsSid),
	};
}

function makeFixture(currentSid, name, options = {}) {
	const directory = path.join(root, "fixtures", name);
	fs.mkdirSync(directory, { recursive: true });
	const directoryDescriptor = options.inheritedEveryone
		? `D:P(A;OICI;FA;;;${currentSid})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;WD)`
		: `D:P(A;OICI;FA;;;${currentSid})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`;
	seed(directory, directoryDescriptor);
	const target = path.join(directory, "é spaced.conf");
	const main = path.join(directory, "main");
	fs.writeFileSync(target, "Host current\n  ProxyCommand original\n");
	fs.writeFileSync(
		main,
		`Include "${directory.replaceAll("\\", "/")}/*.conf"\n`,
	);
	if (!options.inheritedEveryone)
		seed(target, trustedDescriptor(currentSid, options.extraDacl ?? ""));
	seed(main, trustedDescriptor(currentSid));
	return { directory, target, main };
}

async function secure(target) {
	const { WindowsAcl } = require(path.join(root, "windowsAcl.cjs"));
	await new WindowsAcl(path.join(root, "windows-acl.js")).secure(target);
}

function evidenceBefore(fixture) {
	return {
		parentDescriptor: snapshot(fixture.directory),
		main: fileState(fixture.main),
		target: fileState(fixture.target),
	};
}

function unchanged(before, after) {
	return {
		parent: before.parentDescriptor === after.parentDescriptor,
		main: before.main.descriptor === after.main.descriptor,
		hash: before.target.hash === after.target.hash,
		owner: before.target.owner === after.target.owner,
		identity:
			before.target.dev === after.target.dev &&
			before.target.ino === after.target.ino,
	};
}

async function runProductionCase(currentSid, name, options) {
	const fixture = makeFixture(currentSid, name, options);
	const before = evidenceBefore(fixture);
	const first = await settle(() => secure(fixture.target));
	const second = await settle(() => secure(fixture.target));
	const after = evidenceBefore(fixture);
	const sshFirst = openSsh(fixture.main);
	const sshSecond = openSsh(fixture.main);
	const preserved = unchanged(before, after);
	return {
		kind: "production-adapter",
		name,
		fixture,
		before,
		first,
		second,
		after,
		openSsh: [sshFirst, sshSecond],
		exactProtectedDacl: hasOnlyTrustedProtectedDacl(
			after.target.descriptor,
			currentSid,
		),
		preserved,
		success:
			first.ok &&
			second.ok &&
			hasOnlyTrustedProtectedDacl(after.target.descriptor, currentSid) &&
			Object.values(preserved).every(Boolean) &&
			[sshFirst, sshSecond].every(
				(result) =>
					result.ok && result.proxyCommand === "proxycommand original",
			),
	};
}

async function settle(operation) {
	try {
		await operation();
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function workerCases() {
	const identity = standardIdentity();
	const cases = [];
	for (const [name, options] of [
		["safe", {}],
		["inherited-everyone", { inheritedEveryone: true }],
		["explicit-everyone", { extraDacl: "(A;;FW;;;WD)" }],
		[
			"deleted-allow",
			{ extraDacl: `(A;;FW;;;${readJson("accounts.json").deletedSid})` },
		],
		[
			"deleted-deny",
			{ extraDacl: `(D;;FW;;;${readJson("accounts.json").deletedSid})` },
		],
		["synthetic-allow", { extraDacl: `(A;;FW;;;${syntheticSid})` }],
		["synthetic-deny", { extraDacl: `(D;;FW;;;${syntheticSid})` }],
	]) {
		try {
			cases.push(await runProductionCase(identity.sid, name, options));
		} catch (error) {
			cases.push({
				name,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	writeJson("production-cases.json", { identity, cases });
}

function workerSaclPrepare() {
	const identity = standardIdentity();
	const fixture = makeFixture(identity.sid, "sacl-preservation", {
		extraDacl: "(A;;FW;;;WD)",
	});
	writeJson("sacl-fixture.json", {
		identity,
		fixture,
		before: evidenceBefore(fixture),
	});
}

async function workerSaclRun() {
	const { identity, fixture, before } = readJson("sacl-fixture.json");
	const result = await settle(() => secure(fixture.target));
	const backup = path.join(root, "audit-saved-acl.txt");
	must(path.join(system, "icacls.exe"), [fixture.target, "/save", backup]);
	writeJson("sacl-worker-result.json", {
		savedAcl: fs.readFileSync(backup, "utf16le"),
		identity,
		fixture,
		before,
		result,
		after: evidenceBefore(fixture),
	});
}

async function workerForeign() {
	const { identity, fixture, before } = readJson("foreign-fixture.json");
	const result = await settle(() => secure(fixture.target));
	writeJson("foreign-worker-result.json", {
		identity,
		fixture,
		before,
		result,
		after: evidenceBefore(fixture),
	});
}

async function workerDenied() {
	const { identity, fixture, before } = readJson("denied-fixture.json");
	const result = await settle(() => secure(fixture.target));
	writeJson("denied-worker-result.json", { identity, fixture, before, result });
}

async function workerWshDisabled() {
	const identity = standardIdentity();
	const fixture = makeFixture(identity.sid, "wsh-disabled");
	const before = evidenceBefore(fixture);
	const key = "HKCU\\Software\\Microsoft\\Windows Script Host\\Settings";
	must(path.join(system, "reg.exe"), [
		"add",
		key,
		"/v",
		"Enabled",
		"/t",
		"REG_DWORD",
		"/d",
		"0",
		"/f",
	]);
	let result;
	try {
		result = await settle(() => secure(fixture.target));
	} finally {
		run(path.join(system, "reg.exe"), ["delete", key, "/v", "Enabled", "/f"]);
	}
	const after = evidenceBefore(fixture);
	writeJson("wsh-disabled-result.json", {
		identity,
		fixture,
		before,
		result,
		after,
		noAddedEveryoneAccess: !dacl(after.target.descriptor).includes(";;;WD)"),
	});
}

async function worker() {
	if (phase === "cases") return workerCases();
	if (phase === "sacl-prepare") return workerSaclPrepare();
	if (phase === "sacl-run") return workerSaclRun();
	if (phase === "foreign") return workerForeign();
	if (phase === "denied") return workerDenied();
	if (phase === "wsh-disabled") return workerWshDisabled();
	throw new Error(`Unknown worker phase: ${phase}`);
}

function compilerPath() {
	return ["Framework64", "Framework"]
		.map((framework) =>
			path.join(
				process.env.SystemRoot ?? "C:\\Windows",
				"Microsoft.NET",
				framework,
				"v4.0.30319",
				"csc.exe",
			),
		)
		.find(fs.existsSync);
}

function launch(username, password, workerPhase) {
	const result = run(
		runner,
		["run", username, password, node, script, root, workerPhase],
		workerTimeout,
	);
	if (result.message)
		result.message = result.message.replaceAll(password, "[redacted]");
	writeJson(`${workerPhase}-launch.json`, result);
	return result;
}

function prepareForeign(standardSid, liveSid) {
	const fixture = makeFixture(standardSid, "foreign-owner-write-dac");
	const before = evidenceBefore(fixture);
	must(runner, ["setowner", fixture.target, liveSid]);
	seed(
		fixture.target,
		`D:P(A;;WDRC;;;${standardSid})(A;;FA;;;${liveSid})(A;;FA;;;SY)(A;;FA;;;BA)`,
	);
	writeJson("foreign-fixture.json", {
		identity: { sid: standardSid },
		fixture,
		before: evidenceBefore(fixture),
		beforeCreation: before,
	});
}

function prepareDenied(standardSid, liveSid) {
	const fixture = makeFixture(standardSid, "denied-dacl");
	must(runner, ["setowner", fixture.target, liveSid]);
	seed(
		fixture.target,
		`D:P(D;;WD;;;${standardSid})(A;;FA;;;${liveSid})(A;;FA;;;SY)(A;;FA;;;BA)`,
	);
	writeJson("denied-fixture.json", {
		identity: { sid: standardSid },
		fixture,
		before: evidenceBefore(fixture),
	});
}

function admin() {
	fs.mkdirSync(root, { recursive: true });
	const compiler = compilerPath();
	if (!compiler)
		throw new Error("Could not find the .NET Framework C# compiler");
	must(compiler, [
		"/nologo",
		`/out:${runner}`,
		path.join(root, "acl-production-runner.cs"),
	]);
	const suffix = randomBytes(4).toString("hex");
	const users = {
		standard: `CoderAclStd${suffix}`,
		live: `CoderAclLive${suffix}`,
		deleted: `CoderAclDel${suffix}`,
	};
	const password = `Aa1!${randomBytes(18).toString("hex")}`;
	process.stdout.write(`::add-mask::${password}\n`);
	const created = new Set();
	const adminResults = { users, launches: {}, elevated: {}, cleanup: {} };
	try {
		for (const username of Object.values(users)) {
			must(path.join(system, "net.exe"), [
				"user",
				username,
				password,
				"/add",
				"/y",
			]);
			created.add(username);
		}
		const standardSid = must(runner, ["sid", users.standard]);
		const liveSid = must(runner, ["sid", users.live]);
		const deletedSid = must(runner, ["sid", users.deleted]);
		must(path.join(system, "net.exe"), ["user", users.deleted, "/delete"]);
		created.delete(users.deleted);
		writeJson("accounts.json", { standardSid, liveSid, deletedSid });
		must(path.join(system, "icacls.exe"), [
			root,
			"/grant",
			`${numericSid(standardSid)}:(OI)(CI)F`,
		]);
		fs.copyFileSync(process.execPath, node);

		adminResults.launches.cases = launch(users.standard, password, "cases");
		adminResults.launches.saclPrepare = launch(
			users.standard,
			password,
			"sacl-prepare",
		);
		const sacl = readJson("sacl-fixture.json");
		adminResults.elevated.saclBefore = must(runner, [
			"saclsnapshot",
			sacl.fixture.target,
		]);
		must(runner, ["saclseed", sacl.fixture.target]);
		adminResults.elevated.saclSeeded = must(runner, [
			"saclsnapshot",
			sacl.fixture.target,
		]);
		adminResults.launches.saclRun = launch(
			users.standard,
			password,
			"sacl-run",
		);
		adminResults.elevated.saclAfter = must(runner, [
			"saclsnapshot",
			sacl.fixture.target,
		]);
		adminResults.elevated.saclPreserved =
			adminResults.elevated.saclSeeded === adminResults.elevated.saclAfter;

		prepareForeign(standardSid, liveSid);
		adminResults.launches.foreign = launch(users.standard, password, "foreign");
		const foreign = readJson("foreign-worker-result.json");
		adminResults.elevated.foreignOwnerPreserved =
			owner(foreign.fixture.target) === liveSid;
		adminResults.elevated.foreignExactProtectedDacl =
			hasOnlyTrustedProtectedDacl(
				snapshot(foreign.fixture.target),
				standardSid,
			);

		prepareDenied(standardSid, liveSid);
		const deniedBefore = readJson("denied-fixture.json").before;
		adminResults.launches.denied = launch(users.standard, password, "denied");
		const denied = readJson("denied-worker-result.json");
		const deniedAfter = evidenceBefore(denied.fixture);
		adminResults.elevated.deniedDaclUnchanged =
			deniedBefore.target.descriptor === deniedAfter.target.descriptor;
		adminResults.elevated.deniedAdapterFailed = !denied.result.ok;

		adminResults.launches.wshDisabled = launch(
			users.standard,
			password,
			"wsh-disabled",
		);
		const wsh = readJson("wsh-disabled-result.json");
		adminResults.elevated.wshAdapterFailed = !wsh.result.ok;
		adminResults.elevated.wshNoAddedEveryoneAccess = wsh.noAddedEveryoneAccess;
		adminResults.metadata = JSON.parse(must(runner, ["metadata"]));
	} catch (error) {
		adminResults.fatal = error instanceof Error ? error.message : String(error);
	} finally {
		for (const username of created) {
			adminResults.cleanup[username] = run(path.join(system, "net.exe"), [
				"user",
				username,
				"/delete",
			]);
		}
		writeJson("admin-results.json", adminResults);
	}
}

function evaluate() {
	const admin = readJson("admin-results.json");
	const cases = readJson("production-cases.json");
	const sacl = readJson("sacl-worker-result.json");
	const foreign = readJson("foreign-worker-result.json");
	const denied = readJson("denied-worker-result.json");
	const wsh = readJson("wsh-disabled-result.json");
	const expectedCases = [
		"safe",
		"inherited-everyone",
		"explicit-everyone",
		"deleted-allow",
		"deleted-deny",
		"synthetic-allow",
		"synthetic-deny",
	];
	const checks = {
		standardUser: cases.identity.isStandardUser,
		productionCases: expectedCases.every(
			(name) =>
				cases.cases.find((entry) => entry.name === name)?.success === true,
		),
		saclPreserved:
			sacl.result.ok &&
			admin.elevated.saclPreserved === true &&
			hasOnlyTrustedProtectedDacl(
				sacl.after.target.descriptor,
				sacl.identity.sid,
			),
		foreignOwnerWriteDac:
			foreign.result.ok &&
			admin.elevated.foreignOwnerPreserved === true &&
			admin.elevated.foreignExactProtectedDacl === true,
		deniedDaclFailure:
			!denied.result.ok &&
			admin.elevated.deniedAdapterFailed === true &&
			admin.elevated.deniedDaclUnchanged === true,
		wshDisabledFailure:
			!wsh.result.ok &&
			admin.elevated.wshAdapterFailed === true &&
			admin.elevated.wshNoAddedEveryoneAccess === true,
		accountCleanup: Object.values(admin.cleanup).every((result) => result.ok),
	};
	const evaluation = { checks, passed: Object.values(checks).every(Boolean) };
	writeJson("production-evaluation.json", evaluation);
	process.stdout.write(`${JSON.stringify(evaluation)}\n`);
	if (!evaluation.passed) process.exitCode = 1;
}

if (mode === "admin") admin();
else if (mode === "worker") await worker();
else if (mode === "evaluate") evaluate();
else
	throw new Error(
		"Usage: acl-production-probe.mjs <admin|worker|evaluate> <root> [phase]",
	);
