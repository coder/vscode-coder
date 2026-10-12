import {
	hasErrorDiagnostics,
	type ParameterValues,
	type WorkspaceUpdateInit,
} from "@repo/shared";
import { ErrorState, LoadingState } from "@repo/ui";
import { useVsCodeState } from "@repo/webview-shared/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { WorkspaceUpdateForm } from "./components/WorkspaceUpdateForm";
import { useDebouncedValue } from "./useDebouncedValue";
import { useWorkspaceUpdateApi } from "./useWorkspaceUpdateApi";

import type { PreviewParameter } from "coder/site/src/api/typesGenerated";

/** Like the dashboard, only typing is debounced. */
const TYPING_DEBOUNCE_MS = 500;
const TYPED_FORM_TYPES: ReadonlySet<string> = new Set(["input", "textarea"]);

const queryKeys = {
	init: ["init"],
	evaluate: (values: ParameterValues) => ["evaluate", values],
};

export default function App(): React.JSX.Element {
	const api = useWorkspaceUpdateApi();
	const init = useQuery({
		queryKey: queryKeys.init,
		queryFn: () => api.init(),
		staleTime: Infinity,
	});

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
	return <WorkspaceUpdate init={init.data} />;
}

function WorkspaceUpdate({
	init,
}: {
	init: WorkspaceUpdateInit;
}): React.JSX.Element {
	const api = useWorkspaceUpdateApi();
	// Survives the panel being hidden.
	const [values, setValues] = useVsCodeState<ParameterValues>(init.values);
	const [debounceMs, setDebounceMs] = useState(0);
	const inputs = useDebouncedValue(values, debounceMs);
	const evaluation = useQuery({
		queryKey: queryKeys.evaluate(inputs),
		queryFn: () => api.evaluate(inputs),
		initialData: inputs === init.values ? init.evaluation : undefined,
		placeholderData: keepPreviousData,
		// Same inputs on the same template version always evaluate the same.
		staleTime: Infinity,
	});
	// Restored edits start from the initial evaluation until theirs arrives.
	const data = evaluation.data ?? init.evaluation;

	const onChange = (parameter: PreviewParameter, value: string) => {
		setDebounceMs(
			TYPED_FORM_TYPES.has(parameter.form_type) ? TYPING_DEBOUNCE_MS : 0,
		);
		setValues({ ...values, [parameter.name]: value });
	};

	return (
		<WorkspaceUpdateForm
			workspaceName={init.workspaceName}
			restart={init.restart}
			evaluation={data}
			values={values}
			evaluating={evaluation.isFetching}
			error={evaluation.error?.message}
			canSubmit={
				inputs === values &&
				!evaluation.isFetching &&
				!evaluation.isError &&
				!hasErrorDiagnostics(data)
			}
			onChange={onChange}
			onSubmit={(submitted) => api.submit(submitted)}
			onCancel={() => api.cancel()}
		/>
	);
}
