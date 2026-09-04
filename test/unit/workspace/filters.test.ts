import { describe, expect, it } from "vitest";

import { availableFilters, WORKSPACE_FILTERS } from "@/workspace/filters";

import { createMockUser } from "../../mocks/testHelpers";

import type { SessionData } from "@/deployment/sessionStore";

import type { WorkspaceFilter } from "@repo/shared";

type SignedInSession = Extract<SessionData, { kind: "signedIn" }>;

function signedIn(roles: string[] = []): SignedInSession {
	return {
		kind: "signedIn",
		deployment: {
			url: "https://coder.example.com",
			safeHostname: "coder.example.com",
		},
		user: createMockUser({
			id: "user-1",
			roles: roles.map((name) => ({ name, display_name: name })),
		}),
	};
}

const SIGNED_OUT: SessionData = { kind: "signedOut", deployment: null };

describe("WORKSPACE_FILTERS", () => {
	interface QueryCase {
		filter: WorkspaceFilter;
		query: string;
	}

	it.each<QueryCase>([
		{ filter: "mine", query: "owner:me" },
		{ filter: "shared", query: "shared_with_user:user-1" },
		{ filter: "all", query: "" },
	])("queries $filter workspaces", ({ filter, query }) => {
		expect(WORKSPACE_FILTERS[filter].getQuery(signedIn())).toBe(query);
	});
});

describe("availableFilters", () => {
	interface AvailabilityCase {
		name: string;
		session: SessionData;
		unsupported?: WorkspaceFilter[];
		offered: WorkspaceFilter[];
	}

	it.each<AvailabilityCase>([
		{ name: "signed out", session: SIGNED_OUT, offered: [] },
		{ name: "a member", session: signedIn(), offered: ["mine", "shared"] },
		{
			name: "an owner",
			session: signedIn(["owner"]),
			offered: ["mine", "shared", "all"],
		},
		{
			name: "a rejected query",
			session: signedIn(["owner"]),
			unsupported: ["shared"],
			offered: ["mine", "all"],
		},
	])("offers $offered to $name", ({ session, unsupported, offered }) => {
		expect(availableFilters(session, new Set(unsupported))).toEqual(offered);
	});
});
