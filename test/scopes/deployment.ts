import { isAxiosError } from "axios";
import { Api } from "coder/site/src/api/api";
import { randomBytes } from "node:crypto";
import { on, once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { vi } from "vitest";
import * as vscode from "vscode";
import WebSocket, { type RawData } from "ws";

import { fullName } from "@/cli/cliBinary";
import { toSafeHost } from "@/common/url";
import { OAuthAuthorizer } from "@/oauth/authorizer";
import { OAuthCallback } from "@/oauth/oauthCallback";
import { MementoManager } from "@/storage/mementoManager";
import { SecretsManager } from "@/storage/secretsManager";
import { rawDataToString } from "@/websocket/oneWayWebSocket";

import {
	createMockLogger,
	InMemoryMemento,
	InMemorySecretStorage,
	MockCancellationToken,
	MockConfigurationProvider,
	MockProgress,
} from "../mocks/testHelpers";

import type {
	APIKeyScope,
	OAuth2TokenResponse,
	ProvisionerJob,
	Template,
	Workspace,
	WorkspaceBuild,
} from "coder/site/src/api/typesGenerated";

export interface Deployment {
	url: string;
	/** The member's OAuth access token, or an API key from `withScopes`. */
	token: string;
	/** Scopes the server granted `token`. */
	grantedScope: string;
	/** Signed in with `token`. */
	scoped: Api;
	/** The deployment owner, for setup and moving workspaces between states. */
	admin: Api;
	/** Password session, for tokens with other scopes. */
	member: Api;
	memberId: string;
	/** Owned by the member, with automatic updates on. */
	own: Workspace;
	/** Owned by the admin and shared with the member. */
	shared: Workspace;
	/** The template's first version. */
	versionId: string;
	/** CLI binary the deployment serves for this platform. */
	cliPath: string;
}

const PASSWORD = "SomeLongPassw0rd!";

const TAR_BLOCK_SIZE = 512;

/**
 * Needs no infrastructure or modules. `terraform_data` uses the agent token so
 * start builds list the agent among their resources.
 */
const TEMPLATE = `
terraform {
  required_providers {
    coder = { source = "coder/coder" }
  }
}
data "coder_workspace" "me" {}
data "coder_parameter" "size" {
  name    = "size"
  type    = "string"
  default = "small"
  mutable = true
}
data "coder_workspace_preset" "small" {
  name       = "small"
  parameters = { size = "small" }
}
resource "coder_agent" "dev" {
  os   = "linux"
  arch = "amd64"
}
resource "terraform_data" "dev" {
  count = data.coder_workspace.me.start_count
  input = coder_agent.dev.token
}
`;

/**
 * Creates users, a template, two running workspaces and the member's OAuth
 * token. Refuses servers with users but takes over new ones: use a throwaway.
 */
export async function setUpDeployment(url: string): Promise<Deployment> {
	const admin = createClient(url);
	if (await admin.hasFirstUser()) {
		throw new Error(
			`${url} already has users. Reset it with \`docker compose -f test/scopes/compose.yaml down -v\`, then \`up -d --wait\`.`,
		);
	}
	const email = "admin@example.com";
	await admin.getAxiosInstance().post("/api/v2/users/first", {
		email,
		username: "admin",
		password: PASSWORD,
		trial: false,
	});
	await signIn(admin, email);
	// The extension registers itself, and DCR is off by default.
	await admin.getAxiosInstance().put("/api/v2/oauth2-provider/settings", {
		dynamic_client_registration_enabled: true,
	});
	const [org] = (await admin.getAuthenticatedUser()).organization_ids;
	const templateId = await createTemplate(admin, org);

	const memberUser = await admin.createUser({
		email: "member@example.com",
		username: "member",
		name: "",
		password: PASSWORD,
		login_type: "password",
		user_status: null,
		organization_ids: [org],
	});
	const member = await signIn(createClient(url), memberUser.email);
	const [own, shared, cliPath] = await Promise.all([
		createRunningWorkspace(member, "me", "own", templateId),
		createRunningWorkspace(admin, "me", "shared", templateId),
		downloadCli(admin),
	]);
	await admin.updateWorkspaceACL(shared.id, {
		user_roles: { [memberUser.id]: "admin" },
	});
	await member.updateWorkspaceAutomaticUpdates(own.id, "always");

	const { access_token: token, scope: grantedScope } = await signInWithOAuth(
		url,
		member,
	);
	return {
		url,
		token,
		grantedScope: grantedScope ?? "",
		scoped: createClient(url, token),
		admin,
		member,
		memberId: memberUser.id,
		own,
		shared,
		versionId: own.template_active_version_id,
		cliPath,
	};
}

/** Swaps in a member API token limited to `scopes`. */
export async function withScopes(
	deployment: Deployment,
	scopes: readonly string[],
): Promise<Deployment> {
	const { key: token } = await deployment.member.createToken({
		token_name: `scopes-${randomBytes(4).toString("hex")}`,
		lifetime: 0, // the deployment's default
		scopes: scopes as APIKeyScope[],
	});
	return {
		...deployment,
		token,
		grantedScope: scopes.join(" "),
		scoped: createClient(deployment.url, token),
	};
}

/**
 * Promotes a new template version, outdating every workspace on the template.
 * `versionId` and each workspace's `template_active_version_id` go stale.
 */
export async function promoteNewTemplateVersion(
	admin: Api,
	{ organization_id, template_id }: Workspace,
): Promise<void> {
	const id = await createTemplateVersion(admin, organization_id, template_id);
	await admin.updateActiveTemplateVersion(template_id, { id });
}

/** Creates a workspace for `owner` and returns it, with its agents, once built. */
export async function createRunningWorkspace(
	api: Api,
	owner: string,
	name: string,
	templateId: string,
): Promise<Workspace> {
	const workspace = await api.createWorkspace(owner, {
		name,
		template_id: templateId,
	});
	await awaitBuildSuccess(api, workspace.latest_build);
	return api.getWorkspace(workspace.id);
}

export function awaitBuildSuccess(
	api: Api,
	build: WorkspaceBuild,
): Promise<void> {
	return awaitJobSuccess(api, `/api/v2/workspacebuilds/${build.id}`);
}

/** Waits for `parent` and the build queued after it; fails unless both succeed. */
export async function awaitFollowUpBuild(
	api: Api,
	parent: WorkspaceBuild,
): Promise<void> {
	await awaitBuildSuccess(api, parent);
	const socket = openSocket(
		api,
		`/api/v2/workspaces/${parent.workspace_id}/watch-ws`,
	);
	try {
		for await (const [message] of on(socket, "message", {
			close: ["close"],
		})) {
			const event = JSON.parse(rawDataToString(message as RawData)) as {
				type: string;
				data?: Workspace;
			};
			const build =
				event.type === "data" ? event.data?.latest_build : undefined;
			if (build && build.build_number > parent.build_number) {
				return await awaitBuildSuccess(api, build);
			}
		}
		throw new Error(`No build followed build ${parent.build_number}`);
	} finally {
		socket.terminate();
	}
}

/**
 * Waits for the job's log stream to close, which the server does once the job
 * completes, even if it completed before the stream opened. Throws unless the
 * job succeeded.
 */
async function awaitJobSuccess(api: Api, path: string): Promise<void> {
	await once(openSocket(api, `${path}/logs?follow=true`), "close");
	const { data } = await api
		.getAxiosInstance()
		.get<{ job: ProvisionerJob }>(path);
	if (data.job.status !== "succeeded") {
		throw new Error(`${path}: job ${data.job.status}: ${data.job.error ?? ""}`);
	}
}

export function openSocket(api: Api, path: string): WebSocket {
	const url = new URL(path, api.getAxiosInstance().defaults.baseURL);
	url.protocol = url.protocol.replace("http", "ws");
	return new WebSocket(url, {
		headers: { "Coder-Session-Token": api.getSessionToken() ?? "" },
	});
}

function createClient(url: string, token?: string): Api {
	const api = new Api();
	api.setHost(url);
	if (token) {
		api.setSessionToken(token);
	}
	api
		.getAxiosInstance()
		.interceptors.response.use(undefined, (error: unknown) => {
			if (
				isAxiosError<{ message?: string; detail?: string }>(error) &&
				error.response
			) {
				const { config, response } = error;
				const reason = [response.data?.message, response.data?.detail]
					.filter(Boolean)
					.join(": ");
				error.message = `${config?.method?.toUpperCase()} ${config?.url}: ${response.status} ${reason}`;
			}
			throw error;
		});
	return api;
}

async function signIn(api: Api, email: string): Promise<Api> {
	const { session_token } = await api.login(email, PASSWORD);
	api.setSessionToken(session_token);
	return api;
}

/** Runs the extension's OAuth login, consenting as `member` in place of the browser. */
async function signInWithOAuth(
	url: string,
	member: Api,
): Promise<OAuth2TokenResponse> {
	new MockConfigurationProvider();
	const secrets = new InMemorySecretStorage();
	const logger = createMockLogger();
	const callback = new OAuthCallback(secrets, logger);
	const authorizer = new OAuthAuthorizer(
		new SecretsManager(
			secrets,
			new MementoManager(new InMemoryMemento()),
			logger,
		),
		callback,
		logger,
		"coder.coder-remote",
	);
	vi.mocked(vscode.env.openExternal).mockImplementation(async (uri) => {
		const consent = await member
			.getAxiosInstance()
			.post(uri.toString(), undefined, {
				maxRedirects: 0,
				validateStatus: (status) => status === 302,
			});
		const { searchParams } = new URL(String(consent.headers.location));
		const error = searchParams.get("error");
		await callback.send({
			state: searchParams.get("state") ?? "",
			code: searchParams.get("code"),
			error:
				error && `${error}: ${searchParams.get("error_description") ?? ""}`,
		});
		return true;
	});
	try {
		const { tokenResponse } = await authorizer.login(
			{ url, safeHostname: toSafeHost(url) },
			new MockProgress(),
			new MockCancellationToken(),
		);
		return tokenResponse;
	} finally {
		authorizer.dispose();
	}
}

async function createTemplate(admin: Api, org: string): Promise<string> {
	const versionId = await createTemplateVersion(admin, org);
	const { data: template } = await admin
		.getAxiosInstance()
		.post<Template>(`/api/v2/organizations/${org}/templates`, {
			name: "scopes",
			template_version_id: versionId,
		});
	return template.id;
}

async function createTemplateVersion(
	admin: Api,
	org: string,
	templateId?: string,
): Promise<string> {
	const { hash } = await admin.uploadFile(
		new File([tarFile("main.tf", TEMPLATE)], "template.tar", {
			type: "application/x-tar",
		}),
	);
	const version = await admin.createTemplateVersion(org, {
		storage_method: "file",
		file_id: hash,
		provisioner: "terraform",
		tags: {},
		template_id: templateId,
	});
	await awaitJobSuccess(admin, `/api/v2/templateversions/${version.id}`);
	return version.id;
}

async function downloadCli(api: Api): Promise<string> {
	const { data } = await api
		.getAxiosInstance()
		.get<ArrayBuffer>(`/bin/${fullName()}`, { responseType: "arraybuffer" });
	const dir = await mkdtemp(path.join(tmpdir(), "coder-scopes-"));
	const file = path.join(dir, fullName());
	await writeFile(file, Buffer.from(data), { mode: 0o755 });
	return file;
}

/** Unset tar header fields read as zero. */
function tarFile(name: string, content: string): Buffer<ArrayBuffer> {
	const body = Buffer.from(content);
	const header = Buffer.alloc(TAR_BLOCK_SIZE);
	header.write(name, 0); // name
	header.write("0000644\0", 100); // mode
	header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124); // size
	header.write("        ", 148); // checksum placeholder
	header.write("0", 156); // regular file
	const checksum = header.reduce((sum, byte) => sum + byte, 0);
	header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
	const padding = Buffer.alloc(
		(TAR_BLOCK_SIZE - (body.length % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE,
	);
	return Buffer.concat([
		header,
		body,
		padding,
		Buffer.alloc(2 * TAR_BLOCK_SIZE),
	]);
}
