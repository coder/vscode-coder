import type { WorkspaceAgent } from "coder/site/src/api/typesGenerated";

export type AgentDiagnostic = "ping" | "speedTest" | "supportBundle";

export function agentDiagnostics(
	agent: WorkspaceAgent,
): readonly AgentDiagnostic[] {
	if (agent.status === "connected") {
		return ["ping", "speedTest", "supportBundle"];
	}
	// A support bundle is still useful without a connection.
	return ["supportBundle"];
}
