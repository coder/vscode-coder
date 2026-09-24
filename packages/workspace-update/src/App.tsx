import { ErrorState, LoadingState } from "@repo/ui";
import { useQuery } from "@tanstack/react-query";

import { WorkspaceUpdateForm } from "./components/WorkspaceUpdateForm";
import { useWorkspaceUpdateApi } from "./hooks/useWorkspaceUpdateApi";

export default function App(): React.JSX.Element {
	const api = useWorkspaceUpdateApi();
	const init = useQuery({ queryKey: ["init"], queryFn: () => api.init() });

	if (init.isPending) {
		return <LoadingState label="Loading parameters" />;
	}
	if (init.isError) {
		return (
			<ErrorState
				title="Could not load workspace parameters"
				description={init.error.message}
				onRetry={() => void init.refetch()}
			/>
		);
	}
	return <WorkspaceUpdateForm init={init.data} />;
}
