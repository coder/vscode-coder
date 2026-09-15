import { describe, expect, it } from "vitest";

import {
	availableFilters,
	isQueryRejected,
	WORKSPACE_FILTERS,
} from "@/workspace/filters";

import {
	createAxiosError,
	signedInSession,
	userWithRoles,
} from "../../mocks/testHelpers";

import type { SessionData } from "@/deployment/sessionStore";

import type { WorkspaceFilter } from "@repo/shared";

const MEMBER = signedInSession();
const OWNER = signedInSession(userWithRoles("owner"));
const SIGNED_OUT: SessionData = { kind: "signedOut", deployment: null };

describe("WORKSPACE_FILTERS", () => {
	interface QueryCase {
		filter: WorkspaceFilter;
		query: string;
	}

	it.each<QueryCase>([
		{ filter: "mine", query: "owner:me" },
		{ filter: "shared", query: `shared_with_user:${MEMBER.user.id}` },
		{ filter: "all", query: "" },
	])("queries $filter workspaces", ({ filter, query }) => {
		expect(WORKSPACE_FILTERS[filter].getQuery(MEMBER)).toBe(query);
	});
});

describe("availableFilters", () => {
	interface OfferCase {
		name: string;
		session: SessionData;
		unsupported?: WorkspaceFilter[];
		offered: WorkspaceFilter[];
	}

	it.each<OfferCase>([
		{ name: "signed out", session: SIGNED_OUT, offered: [] },
		{ name: "a member", session: MEMBER, offered: ["mine", "shared"] },
		{ name: "an owner", session: OWNER, offered: ["mine", "shared", "all"] },
		{
			name: "an owner whose deployment rejected one",
			session: OWNER,
			unsupported: ["shared"],
			offered: ["mine", "all"],
		},
	])("offers $name $offered", ({ session, unsupported, offered }) => {
		expect(availableFilters(session, new Set(unsupported))).toEqual(offered);
	});
});

describe("isQueryRejected", () => {
	it("recognizes only a 400 from the deployment", () => {
		expect(isQueryRejected(createAxiosError(400, "invalid query"))).toBe(true);
		expect(isQueryRejected(createAxiosError(500, "down"))).toBe(false);
		expect(isQueryRejected(new Error("offline"))).toBe(false);
	});
});
