import { MOCK_WORKSPACES } from "./mockData";
import { WorkspacesPanel } from "./WorkspacesPanel";

export default function App() {
	// Prototype: mock data only; IPC arrives with the real provider wiring.
	return <WorkspacesPanel workspaces={MOCK_WORKSPACES} isOwner />;
}
