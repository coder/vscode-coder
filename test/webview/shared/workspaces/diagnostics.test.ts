import { describe, expect, it } from "vitest";

import { agent } from "@repo/mocks";
import { agentDiagnostics, type AgentDiagnostic } from "@repo/shared";

import type { WorkspaceAgentStatus } from "coder/site/src/api/typesGenerated";

interface DiagnosticsCase {
	status: WorkspaceAgentStatus;
	diagnostics: AgentDiagnostic[];
}

describe("agentDiagnostics", () => {
	it.each<DiagnosticsCase>([
		{
			status: "connected",
			diagnostics: ["ping", "speedTest", "supportBundle"],
		},
		{ status: "connecting", diagnostics: ["supportBundle"] },
		{ status: "disconnected", diagnostics: ["supportBundle"] },
		{ status: "timeout", diagnostics: ["supportBundle"] },
	])("offers $diagnostics while $status", ({ status, diagnostics }) => {
		expect(agentDiagnostics(agent({ status }))).toEqual(diagnostics);
	});
});
