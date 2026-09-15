import { useWorkspaces } from "./hooks/useWorkspaces";

/** Placeholder: renders the pushed state until the panel UI lands. */
export default function App() {
	const { state } = useWorkspaces();

	if (!state) {
		return <p>Loading workspaces...</p>;
	}
	return <pre>{JSON.stringify(state, null, 2)}</pre>;
}
