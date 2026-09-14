import type { ExperimentCell } from "./experiment.cjs";

export const ARCHITECTURES: string[];
export const VARIANTS: string[];

export function verifyPackage(
	filename: string,
	variant: "helper" | "addon",
): void;
export function collectCell(
	cell: ExperimentCell,
	options?: { root?: string; artifactRoot?: string },
): unknown;
export function createExperimentReport(options?: {
	root?: string;
	artifactRoot?: string;
}): { output: string; report: unknown };
