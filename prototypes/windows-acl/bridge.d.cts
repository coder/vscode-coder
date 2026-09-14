export type AclOperation = "secure" | "inspect";
export type AclVariant = "helper" | "addon";
export type WindowsArchitecture = "x64" | "arm64";

export interface NativeAddon {
	secure(target: string): void | Promise<void>;
	inspect(target: string): string | Promise<string>;
}

export interface HelperResponse {
	version: number;
	ok: boolean;
	sddl?: string | null;
}

export type AddonLoader = (filename: string) => NativeAddon;
export type HelperRunner = (
	file: string,
	args: string[],
	options: {
		windowsHide: boolean;
		timeout: number;
		maxBuffer: number;
	},
) => Promise<{ stdout: string }>;

export interface CreateBridgeOptions {
	variant: AclVariant;
	artifactRoot: string;
	platform?: string;
	arch?: string;
	loadAddon?: AddonLoader;
	runHelper?: HelperRunner;
}

export interface AclBridge {
	secure(target: string): Promise<void | { skipped: true }>;
	inspect(target: string): Promise<string | { skipped: true }>;
}

export function createBridge(options: CreateBridgeOptions): AclBridge;
