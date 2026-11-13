import { signInWithOAuth, type OAuthSession } from "./oauthLogin";
import { createClient, PASSWORD, signIn } from "./server";
import { createRunningWorkspace, createTemplate } from "./workspaces";

import type { Api } from "coder/site/src/api/api";
import type {
	CreateFirstUserRequest,
	Workspace,
} from "coder/site/src/api/typesGenerated";

/** The server under test, as the probes see it. */
export interface Deployment extends OAuthSession {
	url: string;
	/** The member, signed in with the OAuth `token`. */
	scoped: Api;
	/** The deployment owner, for setup that isn't under test. */
	admin: Api;
	/** Owned by the member. */
	own: Workspace;
	/** Owned by the admin and shared with the member. */
	shared: Workspace;
}

/** Calls the server with the OAuth token and throws if it refuses. */
export type Probe = (deployment: Deployment) => Promise<unknown>;

/**
 * Creates the users, workspaces, and OAuth session the probes need. Throws if
 * the server already has users, since setup takes the server over.
 */
export async function setUpDeployment(url: string): Promise<Deployment> {
	const admin = createClient(url);
	if (await admin.hasFirstUser()) {
		throw new Error(
			`${url} already has users. Recreate it with \`docker compose -f test/scopes/compose.yaml up -d --wait --force-recreate --renew-anon-volumes\`.`,
		);
	}
	// `Api.createFirstUser` requires trial details the server ignores without a trial.
	const firstUser: Pick<
		CreateFirstUserRequest,
		"email" | "username" | "password" | "trial"
	> = {
		email: "admin@example.com",
		username: "admin",
		password: PASSWORD,
		trial: false,
	};
	await admin.getAxiosInstance().post("/api/v2/users/first", firstUser);
	await signIn(admin, firstUser.email);
	// Servers disallow the extension's OAuth client registration by default.
	await admin.putOAuth2ProviderSettings({
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
	const [own, shared] = await Promise.all([
		createRunningWorkspace(member, "own", templateId),
		createRunningWorkspace(admin, "shared", templateId),
	]);
	await admin.updateWorkspaceACL(shared.id, {
		user_roles: { [memberUser.id]: "admin" },
	});

	const oauth = await signInWithOAuth(url, member);
	return {
		url,
		...oauth,
		scoped: createClient(url, oauth.token),
		admin,
		own,
		shared,
	};
}
