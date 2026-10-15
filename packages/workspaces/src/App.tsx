import { WorkspacesPanel } from "./components/WorkspacesPanel";
import { useWorkspaces } from "./hooks/useWorkspaces";

export default function App() {
	const { state, api } = useWorkspaces();
	return (
		<div className="workspaces-app">
			<WorkspacesPanel state={state} api={api} />
		</div>
	);
}
