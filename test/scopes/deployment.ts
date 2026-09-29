import { isAxiosError } from "axios";
import { Api } from "coder/site/src/api/api";
import { once } from "node:events";
import WebSocket from "ws";

import type {
	APIKeyScope,
	ProvisionerJob,
	Template,
	Workspace,
	WorkspaceBuild,
} from "coder/site/src/api/typesGenerated";

export interface Deployment {
	url: string;
	/** The member's token, limited to the scopes under test. */
	token: string;
	/** Signed in with `token`. */
	scoped: Api;
	/** The deployment owner, used for setup and to move workspaces between states. */
	admin: Api;
	/** Owned by the member. */
	own: Workspace;
	/** Owned by the admin and shared with the member. */
	shared: Workspace;
	/** The template version both workspaces run. */
	versionId: string;
}

/** Password for every user this module creates. */
const PASSWORD = "SomeLongPassw0rd!";

/** Uses only the coder provider, so builds need no infrastructure or modules. */
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
 * Creates users, a template and two running workspaces on a fresh deployment.
 * Refuses one that already has users, so it never writes to a real server.
 */
export async function setUpDeployment(
	url: string,
	scopes: string,
): Promise<Deployment> {
	const admin = createClient(url);
	if (await admin.hasFirstUser()) {
		throw new Error(`${url} already has users; use a fresh deployment`);
	}
	const email = "admin@example.com";
	await admin.getAxiosInstance().post("/api/v2/users/first", {
		email,
		username: "admin",
		password: PASSWORD,
		trial: false,
	});
	await signIn(admin, email);
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
	const [own, shared] = await Promise.all([
		createRunningWorkspace(member, "me", "own", templateId),
		createRunningWorkspace(admin, "me", "shared", templateId),
	]);
	await admin.updateWorkspaceACL(shared.id, {
		user_roles: { [memberUser.id]: "admin" },
	});

	const { key: token } = await member.createToken({
		token_name: "scopes",
		lifetime: 0, // the deployment's default
		scopes: scopes.split(" ") as APIKeyScope[],
	});
	const scoped = createClient(url, token);
	const versionId = own.template_active_version_id;
	return { url, token, scoped, admin, own, shared, versionId };
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
	await waitForBuild(api, workspace.latest_build);
	return api.getWorkspace(workspace.id);
}

/** Waits for the build to finish and fails unless it succeeded. */
export function waitForBuild(api: Api, build: WorkspaceBuild): Promise<void> {
	return waitForJob(api, `/api/v2/workspacebuilds/${build.id}`);
}

/**
 * Follows the log stream of the job behind `path` (a build or template
 * version), which the server closes once the job completes, even when it
 * completed before the stream opened. Then fails unless the job succeeded.
 */
async function waitForJob(api: Api, path: string): Promise<void> {
	const logs = new URL(
		`${path}/logs?follow=true`,
		api.getAxiosInstance().defaults.baseURL,
	);
	logs.protocol = logs.protocol.replace("http", "ws");
	const headers = { "Coder-Session-Token": api.getSessionToken() ?? "" };
	await once(new WebSocket(logs, { headers }), "close");
	const { data } = await api
		.getAxiosInstance()
		.get<{ job: ProvisionerJob }>(path);
	if (data.job.status !== "succeeded") {
		throw new Error(`${path}: job ${data.job.status}: ${data.job.error ?? ""}`);
	}
}

/** Creates a client whose request errors include the server's message, not just the status. */
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

async function createTemplate(admin: Api, org: string): Promise<string> {
	const { data: file } = await admin
		.getAxiosInstance()
		.post<{ hash: string }>("/api/v2/files", tarFile("main.tf", TEMPLATE), {
			headers: { "Content-Type": "application/x-tar" },
		});
	const version = await admin.createTemplateVersion(org, {
		storage_method: "file",
		file_id: file.hash,
		provisioner: "terraform",
		tags: {},
	});
	await waitForJob(admin, `/api/v2/templateversions/${version.id}`);
	const { data: template } = await admin
		.getAxiosInstance()
		.post<Template>(`/api/v2/organizations/${org}/templates`, {
			name: "scopes",
			template_version_id: version.id,
		});
	return template.id;
}

/** Builds a tar archive holding one file; unset header fields read as zero. */
function tarFile(name: string, content: string): Buffer {
	const body = Buffer.from(content);
	const header = Buffer.alloc(512);
	header.write(name, 0);
	header.write("0000644\0", 100); // mode
	header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
	header.write("        ", 148); // checksum placeholder
	header.write("0", 156); // regular file
	const checksum = header.reduce((sum, byte) => sum + byte, 0);
	header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
	const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
	return Buffer.concat([header, body, padding, Buffer.alloc(1024)]);
}
