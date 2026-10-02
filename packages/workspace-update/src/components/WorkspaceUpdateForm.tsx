import { Button, ProgressBar, ValidationMessage } from "@repo/ui";

import { Diagnostics, ParameterField } from "./ParameterField";

import type { ParameterValues } from "@repo/shared";
import type {
	DynamicParametersResponse,
	PreviewParameter,
} from "coder/site/src/api/typesGenerated";

export interface WorkspaceUpdateFormProps {
	workspaceName: string;
	restart: boolean;
	evaluation: DynamicParametersResponse;
	/** Edits; parameters without one show the server's value. */
	values: ParameterValues;
	evaluating: boolean;
	/** Why the latest evaluation failed. */
	error?: string;
	canSubmit: boolean;
	onChange: (parameter: PreviewParameter, value: string) => void;
	onSubmit: (values: ParameterValues) => void;
	onCancel: () => void;
}

export function WorkspaceUpdateForm({
	workspaceName,
	restart,
	evaluation,
	values,
	evaluating,
	error,
	canSubmit,
	onChange,
	onSubmit,
	onCancel,
}: WorkspaceUpdateFormProps): React.JSX.Element {
	const parameters = evaluation.parameters.toSorted(
		(a, b) => a.order - b.order,
	);
	const valueOf = (parameter: PreviewParameter) =>
		values[parameter.name] ??
		(parameter.value.valid ? parameter.value.value : "");
	const blocked = parameters.some(
		(p) => !p.mutable && p.diagnostics.length > 0,
	);

	return (
		<form
			className="workspace-update"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit(
					Object.fromEntries(
						parameters
							.filter((p) => p.mutable)
							.map((p) => [p.name, valueOf(p)]),
					),
				);
			}}
		>
			{evaluating && (
				<ProgressBar
					label="Evaluating parameters"
					className="workspace-update__progress"
				/>
			)}
			<header className="workspace-update__header">
				<h1>Update {workspaceName}</h1>
				<p>The latest template version needs new parameter values.</p>
			</header>
			{blocked && (
				<ValidationMessage role="alert" severity="error">
					Workspace update blocked: immutable values conflict with the new
					version. Contact your template administrator.
				</ValidationMessage>
			)}
			<Diagnostics diagnostics={evaluation.diagnostics} announce />
			{error && (
				<ValidationMessage role="alert" severity="error">
					{error}
				</ValidationMessage>
			)}
			{parameters.map((parameter) => (
				<ParameterField
					key={parameter.name}
					parameter={parameter}
					value={valueOf(parameter)}
					disabled={parameter.styling.disabled === true || !parameter.mutable}
					onChange={(value) => onChange(parameter, value)}
				/>
			))}
			<footer className="workspace-update__footer">
				<Button variant="secondary" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit" disabled={!canSubmit}>
					{restart ? "Update and restart" : "Update and start"}
				</Button>
			</footer>
		</form>
	);
}
