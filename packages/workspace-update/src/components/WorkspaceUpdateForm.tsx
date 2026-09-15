import {
	Button,
	Checkbox,
	ErrorState,
	Field,
	Input,
	LoadingState,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Textarea,
} from "@repo/ui";
import { useId, useState } from "react";

import type { WorkspaceUpdateState } from "@repo/shared";
import type { PreviewParameter } from "coder/site/src/api/typesGenerated";

export interface WorkspaceUpdateFormProps {
	state: WorkspaceUpdateState;
	onCancel: () => void;
	onChange: (change: { name: string; value: string }) => void;
	onRetry: () => void;
	onSubmit: (revision: number) => void;
}

const TAG_SELECT_HELP =
	'Enter a JSON string array, for example ["us-east", "team,blue"]. This preserves items containing commas.';

/** Parse a tag-select value without treating commas as separators. */
export function parseTagSelectValue(value: string): string[] | undefined {
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) &&
			parsed.every((item) => typeof item === "string")
			? parsed
			: undefined;
	} catch {
		return undefined;
	}
}

function parameterValue(
	parameter: PreviewParameter,
	inputs: Readonly<Record<string, string>>,
): string {
	return (
		inputs[parameter.name] ??
		(parameter.value.valid ? parameter.value.value : "")
	);
}

function parameterLabel(parameter: PreviewParameter): string {
	return `${parameter.styling.label || parameter.display_name || parameter.name}${parameter.required ? " (required)" : ""}`;
}

function formatDiagnostics(parameter: PreviewParameter): string | undefined {
	const errors = parameter.diagnostics
		.filter((diagnostic) => diagnostic.severity === "error")
		.map((diagnostic) =>
			[diagnostic.summary, diagnostic.detail].filter(Boolean).join(" — "),
		)
		.filter(Boolean);
	return errors.length > 0 ? errors.join(" ") : undefined;
}

function parameterDescription(
	parameter: PreviewParameter,
	locked: boolean,
): string | undefined {
	const description = [
		parameter.description,
		parameter.form_type === "tag-select" ? TAG_SELECT_HELP : undefined,
		locked
			? "This parameter is locked."
			: !parameter.mutable
				? "This value cannot be changed after this update."
				: undefined,
		parameter.ephemeral
			? "This value resets to its default on the next build."
			: undefined,
	]
		.filter(Boolean)
		.join(" ");
	return description || undefined;
}

function range(parameter: PreviewParameter): { min?: number; max?: number } {
	const min = parameter.validations.find(
		(validation) => validation.validation_min !== null,
	)?.validation_min;
	const max = parameter.validations.find(
		(validation) => validation.validation_max !== null,
	)?.validation_max;
	return {
		...(min !== null && min !== undefined ? { min } : {}),
		...(max !== null && max !== undefined ? { max } : {}),
	};
}

interface ParameterFieldProps {
	disabled: boolean;
	parameter: PreviewParameter;
	value: string;
	onChange: (value: string) => void;
}

function ParameterField({
	disabled,
	parameter,
	value,
	onChange,
}: ParameterFieldProps): React.JSX.Element {
	const id = useId();
	const descriptionId = `${id}-description`;
	const errorId = `${id}-error`;
	const error = formatDiagnostics(parameter);
	const description = parameterDescription(parameter, disabled);
	const options = parameter.options.filter((option) => option.value.valid);
	const formType =
		parameter.form_type ||
		(parameter.type === "bool"
			? "checkbox"
			: parameter.type === "list(string)"
				? "tag-select"
				: options.length
					? "dropdown"
					: "input");
	const describedBy = [description && descriptionId, error && errorId]
		.filter(Boolean)
		.join(" ");
	const common = {
		disabled,
		"aria-describedby": describedBy || undefined,
		"aria-invalid": error ? true : undefined,
	};

	if (formType === "error") {
		return (
			<Field
				label={parameterLabel(parameter)}
				error={error ?? parameter.description}
			>
				<div role="alert" className="workspace-update-form__parameter-error">
					This parameter cannot be configured.
				</div>
			</Field>
		);
	}

	if (formType === "checkbox" || formType === "switch") {
		return (
			<Field
				label={parameterLabel(parameter)}
				description={description}
				descriptionId={descriptionId}
				error={error}
				errorId={errorId}
			>
				<Checkbox
					aria-label={parameterLabel(parameter)}
					{...common}
					checked={value === "true"}
					onChange={(checked) => onChange(String(checked))}
				>
					{value === "true" ? "Enabled" : "Disabled"}
				</Checkbox>
			</Field>
		);
	}

	if (formType === "multi-select") {
		const selected = parseTagSelectValue(value) ?? [];
		return (
			<Field
				label={parameterLabel(parameter)}
				description={description}
				descriptionId={descriptionId}
				error={error}
				errorId={errorId}
			>
				<div className="workspace-update-form__options" {...common}>
					{options.map((option) => {
						const optionValue = option.value.valid ? option.value.value : "";
						const checked = selected.includes(optionValue);
						return (
							<Checkbox
								key={`${option.name}-${optionValue}`}
								disabled={disabled}
								checked={checked}
								onChange={(nextChecked) => {
									const next = nextChecked
										? [...selected, optionValue]
										: selected.filter((item) => item !== optionValue);
									onChange(JSON.stringify(next));
								}}
							>
								<span>{option.name || optionValue}</span>
								{option.description ? (
									<span className="workspace-update-form__option-description">
										{option.description}
									</span>
								) : null}
							</Checkbox>
						);
					})}
				</div>
			</Field>
		);
	}

	if (formType === "dropdown" || formType === "radio") {
		const selectedIndex = options.findIndex(
			(option) => (option.value.valid ? option.value.value : "") === value,
		);
		return (
			<Field
				label={parameterLabel(parameter)}
				description={description}
				descriptionId={descriptionId}
				error={error}
				errorId={errorId}
			>
				<Select
					disabled={disabled}
					value={selectedIndex >= 0 ? String(selectedIndex) : ""}
					onValueChange={(index) => {
						const option = options[Number(index)];
						if (option) onChange(option.value.valid ? option.value.value : "");
					}}
				>
					<SelectTrigger {...common} aria-label={parameterLabel(parameter)}>
						<SelectValue placeholder="Select an option" />
					</SelectTrigger>
					<SelectContent>
						{options.map((option, index) => (
							<SelectItem
								key={`${option.name}-${option.value.value}`}
								value={String(index)}
								description={option.description || undefined}
							>
								{option.name || (option.value.valid ? option.value.value : "")}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</Field>
		);
	}

	const tagSelectInvalid =
		formType === "tag-select" && !parseTagSelectValue(value)
			? "Enter a JSON array of strings."
			: undefined;
	const numeric = formType === "slider" || parameter.type === "number";
	return (
		<Field
			label={parameterLabel(parameter)}
			htmlFor={id}
			description={description}
			descriptionId={descriptionId}
			error={tagSelectInvalid ?? error}
			errorId={errorId}
		>
			{formType === "textarea" ? (
				<Textarea
					{...common}
					id={id}
					value={value}
					onChange={onChange}
					placeholder={parameter.styling.placeholder}
				/>
			) : (
				<Input
					{...common}
					id={id}
					type={
						parameter.styling.mask_input
							? "password"
							: numeric
								? "number"
								: "text"
					}
					value={value}
					onChange={onChange}
					placeholder={parameter.styling.placeholder}
					{...(numeric ? range(parameter) : {})}
				/>
			)}
		</Field>
	);
}

export function WorkspaceUpdateForm({
	state,
	onCancel,
	onChange,
	onRetry,
	onSubmit,
}: WorkspaceUpdateFormProps): React.JSX.Element {
	const [drafts, setDrafts] = useState<Record<string, string>>({});

	const [lastInputs, setLastInputs] = useState(state.inputs);
	if (lastInputs !== state.inputs) {
		setLastInputs(state.inputs);
		setDrafts((current) =>
			Object.fromEntries(
				Object.entries(current).filter(
					([name, value]) =>
						state.parameters.some((parameter) => parameter.name === name) &&
						state.inputs[name] !== value,
				),
			),
		);
	}
	const editing = Object.entries(drafts).some(
		([name, value]) => state.inputs[name] !== value,
	);
	const invalidList = state.parameters.some(
		(parameter) =>
			(parameter.form_type === "tag-select" ||
				(!parameter.form_type && parameter.type === "list(string)")) &&
			!parseTagSelectValue(
				drafts[parameter.name] ?? parameterValue(parameter, state.inputs),
			),
	);
	const formDisabled =
		state.status === "submitting" ||
		(state.status === "error" && !state.canRetry);
	const submitDisabled =
		formDisabled ||
		editing ||
		invalidList ||
		state.status !== "ready" ||
		!state.canSubmit;

	const change = (name: string, value: string) => {
		setDrafts((current) => ({ ...current, [name]: value }));
		onChange({ name, value });
	};

	if (state.status === "loading" && state.parameters.length === 0) {
		return (
			<LoadingState
				label="Loading workspace parameters"
				title="Loading parameters"
			/>
		);
	}

	if (state.status === "success") {
		return (
			<div className="workspace-update-form__terminal">
				<h1>Workspace updated</h1>
				<p>{state.workspaceName} is running the selected template version.</p>
			</div>
		);
	}

	if (state.status === "error" && state.parameters.length === 0) {
		return (
			<ErrorState
				title="Could not prepare workspace update"
				description={state.error}
				action={
					<div className="workspace-update-form__actions">
						<Button variant="secondary" onClick={onCancel}>
							Cancel
						</Button>
						{state.canRetry && <Button onClick={onRetry}>Try again</Button>}
					</div>
				}
			/>
		);
	}

	return (
		<form
			className="workspace-update-form"
			onSubmit={(event) => {
				event.preventDefault();
				if (!submitDisabled) onSubmit(state.revision);
			}}
		>
			<header className="workspace-update-form__header">
				<h1>Update {state.workspaceName}</h1>
				<p>Review the parameters before updating your workspace.</p>
				<p>
					Updating restarts the workspace, stops running processes, and may
					discard unsaved work.
				</p>
				{state.status === "submitting" && (
					<p role="status">
						Closing this tab does not cancel a build that has already started.
					</p>
				)}
			</header>
			{state.error ? (
				<div role="alert" className="workspace-update-form__error">
					{state.error}
				</div>
			) : null}
			{state.diagnostics.length > 0 ? (
				<div role="alert" className="workspace-update-form__diagnostics">
					{state.diagnostics.map((diagnostic) => (
						<p
							key={`${diagnostic.severity}-${diagnostic.summary}-${diagnostic.detail}`}
						>
							{[diagnostic.summary, diagnostic.detail]
								.filter(Boolean)
								.join(" — ")}
						</p>
					))}
				</div>
			) : null}
			{state.status === "evaluating" ? (
				<p className="workspace-update-form__evaluating" role="status">
					Evaluating parameters…
				</p>
			) : null}
			<div className="workspace-update-form__fields">
				{state.parameters.map((parameter) => {
					const locked =
						state.locked.includes(parameter.name) ||
						parameter.styling.disabled === true;
					return (
						<ParameterField
							key={parameter.name}
							parameter={parameter}
							value={
								drafts[parameter.name] ??
								parameterValue(parameter, state.inputs)
							}
							disabled={formDisabled || locked}
							onChange={(value) => change(parameter.name, value)}
						/>
					);
				})}
			</div>
			<footer className="workspace-update-form__actions">
				<Button
					variant="secondary"
					onClick={onCancel}
					disabled={state.status === "submitting"}
				>
					Cancel
				</Button>
				{state.status === "error" && state.canRetry && (
					<Button onClick={onRetry}>Try again</Button>
				)}
				<Button type="submit" disabled={submitDisabled}>
					{state.status === "submitting" ? "Updating…" : "Update and Restart"}
				</Button>
			</footer>
		</form>
	);
}
