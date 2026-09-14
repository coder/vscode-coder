export type AclVariant = "helper" | "addon";

export interface PrototypeManifest {
	name: string;
	displayName: string;
	version: string;
	publisher: string;
	description: string;
	engines: { vscode: string };
	main: string;
	activationEvents: [];
}

export interface AssembleOptions {
	root?: string;
	artifactRoot?: string;
}

export interface PackagePrototypeOptions extends AssembleOptions {
	vsce?: string;
}

export const ARTIFACT_ROOT: string;
export const VARIANTS: Set<AclVariant>;
export const WINDOWS_ARCHITECTURES: string[];
export function assemble(
	variant: AclVariant,
	options?: AssembleOptions,
): string;
export function packageManifest(variant: AclVariant): PrototypeManifest;
export function packagePrototype(
	variant: AclVariant,
	options?: PackagePrototypeOptions,
): string;
export function parseArguments(args: string[]): AclVariant;
