import { describe, expect, it } from "vitest";

import { createWorkspaceIdentifier, isOwner } from "@/api/models";

import { workspace } from "@repo/mocks";

import { userWithRoles } from "../../mocks/testHelpers";

describe("isOwner", () => {
	interface OwnerCase {
		name: string;
		roles: string[] | undefined;
		owner: boolean;
	}

	it.each<OwnerCase>([
		{ name: "nobody", roles: undefined, owner: false },
		{ name: "a member", roles: ["member"], owner: false },
		{ name: "an owner among others", roles: ["auditor", "owner"], owner: true },
	])("is $owner for $name", ({ roles, owner }) => {
		expect(isOwner(roles ? userWithRoles(...roles) : undefined)).toBe(owner);
	});
});

describe("createWorkspaceIdentifier", () => {
	it("joins owner and workspace name", () => {
		expect(
			createWorkspaceIdentifier(
				workspace({ owner_name: "alice", name: "dev" }),
			),
		).toBe("alice/dev");
	});

	it.each([
		{ owner_name: "--url=https://evil", name: "dev" },
		{ owner_name: "alice", name: "dev$(id)" },
	])("rejects $owner_name/$name before it reaches CLI argv", (names) => {
		expect(() => createWorkspaceIdentifier(workspace(names))).toThrow(
			/Cannot use this workspace (owner|name)/,
		);
	});
});
