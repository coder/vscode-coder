import { strToU8, zipSync } from "fflate";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { vi } from "vitest";

import { extractAgents } from "@/api/models";

import type { Api } from "coder/site/src/api/api";
import type {
	CreateTemplateRequest,
	ProvisionerJob,
	Template,
	Workspace,
	WorkspaceBuild,
} from "coder/site/src/api/typesGenerated";

const TEMPLATE_PATH = path.join(import.meta.dirname, "template.tf");

/** Builds of template.tf take seconds; this leaves room under the test timeout. */
const JOB_TIMEOUT_MS = 60_000;

/** Creates a template from template.tf and returns its ID. */
export async function createTemplate(admin: Api, org: string): Promise<string> {
	const versionId = await createTemplateVersion(admin, org);
	// `Api.createTemplate` requires every field; the server defaults the rest.
	const request: Pick<CreateTemplateRequest, "name" | "template_version_id"> = {
		name: "scopes",
		template_version_id: versionId,
	};
	const { data } = await admin
		.getAxiosInstance()
		.post<Template>(`/api/v2/organizations/${org}/templates`, request);
	return data.id;
}

/** Promotes a new template version, outdating every workspace on the template. */
export async function promoteNewTemplateVersion(
	admin: Api,
	{ organization_id, template_id }: Workspace,
): Promise<void> {
	const id = await createTemplateVersion(admin, organization_id, template_id);
	await admin.updateActiveTemplateVersion(template_id, { id });
}

/** Creates a workspace for the signed-in user and returns it once built. */
export async function createRunningWorkspace(
	api: Api,
	name: string,
	templateId: string,
): Promise<Workspace> {
	const workspace = await api.createWorkspace("me", {
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
	return awaitJobSuccess(
		`${build.workspace_name} build ${build.build_number}`,
		async () => {
			const { job } = await api.getWorkspaceBuildByNumber(
				build.workspace_owner_name,
				build.workspace_name,
				build.build_number,
			);
			return job;
		},
	);
}

/** Waits for `parent` and the build the server queues after it. */
export async function awaitFollowUpBuild(
	api: Api,
	parent: WorkspaceBuild,
): Promise<void> {
	await awaitBuildSuccess(api, parent);
	const next = await vi.waitFor(
		async () => {
			const { latest_build } = await api.getWorkspace(parent.workspace_id);
			if (latest_build.build_number <= parent.build_number) {
				throw new Error(`No build followed build ${parent.build_number}`);
			}
			return latest_build;
		},
		{ timeout: JOB_TIMEOUT_MS, interval: 500 },
	);
	await awaitBuildSuccess(api, next);
}

/** The agent of the workspace's latest build, the only one the server serves. */
export async function currentAgentId(
	admin: Api,
	workspace: Workspace,
): Promise<string> {
	const { latest_build } = await admin.getWorkspace(workspace.id);
	const [agent] = extractAgents(latest_build.resources);
	if (!agent) {
		throw new Error(`Build ${latest_build.build_number} has no agent`);
	}
	return agent.id;
}

async function createTemplateVersion(
	admin: Api,
	org: string,
	templateId?: string,
): Promise<string> {
	const template = await readFile(TEMPLATE_PATH, "utf8");
	const { hash } = await admin.uploadFile(
		new File([zipSync({ "main.tf": strToU8(template) })], "template.zip", {
			type: "application/zip",
		}),
	);
	const version = await admin.createTemplateVersion(org, {
		storage_method: "file",
		file_id: hash,
		provisioner: "terraform",
		tags: {},
		template_id: templateId,
	});
	await awaitJobSuccess(`Template version ${version.name}`, async () => {
		const { job } = await admin.getTemplateVersion(version.id);
		return job;
	});
	return version.id;
}

async function awaitJobSuccess(
	label: string,
	getJob: () => Promise<ProvisionerJob>,
): Promise<void> {
	const job = await vi.waitFor(
		async () => {
			const job = await getJob();
			if (["pending", "running", "canceling"].includes(job.status)) {
				throw new Error(`${label}: job still ${job.status}`);
			}
			return job;
		},
		{ timeout: JOB_TIMEOUT_MS, interval: 500 },
	);
	if (job.status !== "succeeded") {
		throw new Error(`${label}: job ${job.status}: ${job.error ?? ""}`);
	}
}
