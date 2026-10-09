import { vi } from "vitest";

import { Commands } from "@/commands";

import { createTestCoderApi } from "./coderApi";
import { createTestTelemetryService } from "./telemetry";
import { createMockLogger } from "./testHelpers";

import type { CoderApi } from "@/api/coderApi";
import type { ServiceContainer } from "@/container";
import type { DeploymentManager } from "@/deployment/deploymentManager";

/** Build `Commands`; services left unnamed stand in as empty objects. */
export function createTestCommands(
	options: {
		services?: Record<string, unknown>;
		baseUrl?: string;
		client?: Partial<CoderApi>;
	} = {},
): Commands {
	const services: Record<string, unknown> = {
		getTelemetryService: createTestTelemetryService(),
		getLogger: createMockLogger(),
		getMementoManager: { setStartupMode: vi.fn() },
		getDuplicateWorkspaceIpc: {
			sendPing: vi.fn().mockResolvedValue(undefined),
		},
		...options.services,
	};
	return new Commands(
		new Proxy({} as ServiceContainer, {
			get: (_, name: string) => () => services[name] ?? {},
		}),
		createTestCoderApi({ baseUrl: options.baseUrl, overrides: options.client }),
		{} as DeploymentManager,
	);
}
