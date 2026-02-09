import { useQuery } from "@tanstack/react-query";
import {
	VscodeButton,
	VscodeIcon,
	VscodeProgressRing,
} from "@vscode-elements/react-elements";

import { useTasksApi } from "./hooks/useTasksApi";

export default function App() {
	const api = useTasksApi();

	const { data, isLoading, error, refetch } = useQuery({
		queryKey: ["tasks-init"],
		queryFn: () => api.init(),
	});

	if (isLoading) {
		return <VscodeProgressRing />;
	}

	if (error) {
		return <p>Error: {error.message}</p>;
	}

	if (!data?.tasksSupported) {
		return (
			<p>
				<VscodeIcon name="warning" /> Tasks not supported
			</p>
		);
	}

	return (
		<div>
			<p>
				<VscodeIcon name="check" /> Connected to {data.baseUrl}
			</p>
			<p>Templates: {data.templates.length}</p>
			<p>Tasks: {data.tasks.length}</p>
			<VscodeButton icon="refresh" onClick={() => void refetch()}>
				Refresh
			</VscodeButton>
		</div>
	);
}
