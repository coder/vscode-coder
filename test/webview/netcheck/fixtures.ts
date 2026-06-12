import type { NetcheckReport } from "@repo/shared";

export function report(overrides?: {
	derp?: Partial<NetcheckReport["derp"]>;
	interfaces?: Partial<NetcheckReport["interfaces"]>;
}): NetcheckReport {
	return {
		derp: {
			severity: "ok",
			warnings: [],
			regions: {},
			...overrides?.derp,
		},
		interfaces: {
			severity: "ok",
			warnings: [],
			interfaces: [],
			...overrides?.interfaces,
		},
	};
}
