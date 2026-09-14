export interface ExperimentCell {
	name: string;
	source: "baseline" | "current";
	optLevel?: "3" | "s" | "z";
	crtStatic?: boolean;
	features?: string[];
}

export interface PortableExecutable {
	architecture: "x64" | "arm64";
	imports: string[];
}

export const ARTIFACT_ROOT: string;
export const BASELINE_REVISION: string;
export const EXPERIMENT_ROOT: string;
export const CELLS: ExperimentCell[];
export const WINDOWS_TARGETS: Map<string, "x64" | "arm64">;

export function parseArguments(args: string[]): string;
export function targetEnvironmentName(target: string): string;
export function baselineRoot(value?: string): string;
export function sourceRootFor(
	cell: ExperimentCell,
	root: string,
	configuredBaselineRoot?: string,
): string;
export function buildEnvironment(
	target: string,
	cell: ExperimentCell,
	targetDirectory: string,
): NodeJS.ProcessEnv;
export function parsePortableExecutable(buffer: Buffer): PortableExecutable;
export function reportFilename(arch: "x64" | "arm64"): string;
export function electron37Path(value?: string): string;
export function vitestEntrypoint(): string;
export function runtimeTest(root: string): string[];
export function runExperiment(target: string): unknown[];
