import type { WorkspaceAgent } from "coder/site/src/api/typesGenerated";

export type AgentDiagnostic = "ping" | "speedTest" | "supportBundle";

/** A support bundle is still useful without a connection. */
export function agentDiagnostics(
	agent: WorkspaceAgent,
): readonly AgentDiagnostic[] {
	return agent.status === "connected"
		? ["ping", "speedTest", "supportBundle"]
		: ["supportBundle"];
}
