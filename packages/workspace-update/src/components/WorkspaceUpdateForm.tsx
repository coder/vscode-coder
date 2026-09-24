import {
	hasErrorDiagnostics,
	type ParameterValues,
	type WorkspaceUpdateInit,
} from "@repo/shared";
import {
	Button,
	ErrorState,
	LoadingState,
	ProgressBar,
	ValidationMessage,
} from "@repo/ui";
import { useVsCodeState } from "@repo/webview-shared/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useWorkspaceUpdateApi } from "../hooks/useWorkspaceUpdateApi";

import { formatDiagnostic, ParameterField } from "./ParameterField";

import type { PreviewParameter } from "coder/site/src/api/typesGenerated";

/** Like the dashboard, only typing is debounced. */
const TYPING_DEBOUNCE_MS = 500;

export function WorkspaceUpdateForm({
	init,
}: {
	init: WorkspaceUpdateInit;
}): React.JSX.Element {
	const api = useWorkspaceUpdateApi();
	// Survives hiding; missing values follow the server.
	const [values, setValues] = useVsCodeState<ParameterValues>(init.values);
	const [debounceMs, setDebounceMs] = useState(0);
	const inputs = useDebouncedValue(values, debounceMs);
	const evaluation = useQuery({
		queryKey: ["evaluate", inputs],
		queryFn: () => api.evaluate(inputs),
		placeholderData: keepPreviousData,
	});

	if (!evaluation.data) {
		return evaluation.isError ? (
			<ErrorState
				title="Could not evaluate workspace parameters"
				description={evaluation.error.message}
				onRetry={() => void evaluation.refetch()}
			/>
		) : (
			<LoadingState label="Evaluating parameters" />
		);
	}

	const { diagnostics } = evaluation.data;
	const parameters = [...evaluation.data.parameters].sort(
		(a, b) => a.order - b.order,
	);
	const valueOf = (parameter: PreviewParameter) =>
		values[parameter.name] ??
		(parameter.value.valid ? parameter.value.value : "");
	const blocked = parameters.some(
		(p) => !p.mutable && p.diagnostics.length > 0,
	);
	const canSubmit =
		inputs === values &&
		!evaluation.isFetching &&
		!evaluation.isError &&
		!hasErrorDiagnostics(evaluation.data);

	return (
		<form
			className="workspace-update"
			onSubmit={(event) => {
				event.preventDefault();
				api.submit(
					Object.fromEntries(
						parameters
							.filter((p) => p.mutable)
							.map((p) => [p.name, valueOf(p)]),
					),
				);
			}}
		>
			{evaluation.isFetching && (
				<ProgressBar
					label="Evaluating parameters"
					className="workspace-update__progress"
				/>
			)}
			<header className="workspace-update__header">
				<h1>Update {init.workspaceName}</h1>
				<p>The latest template version needs new parameter values.</p>
			</header>
			{blocked && (
				<ValidationMessage role="alert" severity="error">
					Workspace update blocked: immutable values conflict with the new
					version. Contact your template administrator.
				</ValidationMessage>
			)}
			{diagnostics.map((d) => (
				<ValidationMessage
					key={`${d.summary}:${d.detail}`}
					role={d.severity === "error" ? "alert" : "status"}
					severity={d.severity}
				>
					{formatDiagnostic(d)}
				</ValidationMessage>
			))}
			{evaluation.isError && (
				<ValidationMessage role="alert" severity="error">
					{evaluation.error.message}
				</ValidationMessage>
			)}
			{parameters.map((parameter) => (
				<ParameterField
					key={parameter.name}
					parameter={parameter}
					value={valueOf(parameter)}
					disabled={parameter.styling.disabled === true || !parameter.mutable}
					onChange={(value) => {
						setDebounceMs(
							parameter.form_type === "input" ||
								parameter.form_type === "textarea"
								? TYPING_DEBOUNCE_MS
								: 0,
						);
						setValues({ ...values, [parameter.name]: value });
					}}
				/>
			))}
			<footer className="workspace-update__footer">
				<Button variant="secondary" onClick={() => api.cancel()}>
					Cancel
				</Button>
				<Button type="submit" disabled={!canSubmit}>
					{init.restart ? "Update and restart" : "Update and start"}
				</Button>
			</footer>
		</form>
	);
}
