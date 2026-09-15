import { WorkspaceUpdateForm } from "./components/WorkspaceUpdateForm";
import { useWorkspaceUpdate } from "./hooks/useWorkspaceUpdate";

export default function App(): React.JSX.Element {
	const { api, state } = useWorkspaceUpdate();

	if (!state) {
		return (
			<div className="workspace-update-app__loading">
				Loading workspace update…
			</div>
		);
	}

	return (
		<WorkspaceUpdateForm
			state={state}
			onChange={api.change}
			onCancel={api.cancel}
			onRetry={api.retry}
			onSubmit={(revision) => api.submit({ revision })}
		/>
	);
}
