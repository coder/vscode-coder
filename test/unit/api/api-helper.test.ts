import { describe, expect, it } from "vitest";

import { isOwner } from "@/api/api-helper";

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
