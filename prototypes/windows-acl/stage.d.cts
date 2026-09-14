export interface TargetDestination {
	platform: "win32" | "linux";
	arch: "x64" | "arm64";
}

export type RustTarget =
	| "x86_64-pc-windows-msvc"
	| "aarch64-pc-windows-msvc"
	| "x86_64-unknown-linux-gnu"
	| "aarch64-unknown-linux-gnu";

export interface StageOptions {
	root?: string;
	artifactRoot?: string;
}

export const ARTIFACT_ROOT: string;
export const TARGETS: Map<RustTarget, TargetDestination>;
export function nativeOutputs(
	platform: TargetDestination["platform"],
): string[][];
export function parseArguments(args: string[]): RustTarget;
export function stage(target: RustTarget, options?: StageOptions): string;
