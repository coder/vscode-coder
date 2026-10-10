import { parseMultiSelectValue } from "@repo/shared";
import {
	Checkbox,
	Field,
	Input,
	PasswordInput,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	StatusPill,
	Textarea,
	ValidationMessage,
} from "@repo/ui";
import { useId } from "react";

import type {
	FriendlyDiagnostic,
	PreviewParameter,
} from "coder/site/src/api/typesGenerated";

interface ParameterFieldProps {
	parameter: PreviewParameter;
	value: string;
	disabled: boolean;
	onChange: (value: string) => void;
}

interface ParameterControlProps extends ParameterFieldProps {
	id: string;
	label: string;
	describedBy: string | undefined;
	invalid: boolean;
}

export function Diagnostics({
	diagnostics,
	announce = false,
}: {
	diagnostics: readonly FriendlyDiagnostic[];
	announce?: boolean;
}): React.JSX.Element[] {
	return diagnostics.map(({ severity, summary, detail }) => {
		const role = severity === "error" ? "alert" : "status";
		return (
			<ValidationMessage
				key={`${summary}:${detail}`}
				role={announce ? role : undefined}
				severity={severity}
			>
				{detail ? `${summary}: ${detail}` : summary}
			</ValidationMessage>
		);
	});
}

/** Like the dashboard's `DynamicParameter`. */
export function ParameterField(props: ParameterFieldProps): React.JSX.Element {
	const { parameter } = props;
	const id = useId();
	const label = parameter.display_name || parameter.name;
	const required = parameter.diagnostics.find(
		(d) => d.extra?.code === "required",
	);
	const diagnostics = parameter.diagnostics.filter((d) => d !== required);
	const descriptionId = `${id}-description`;
	const diagnosticsId = `${id}-diagnostics`;

	return (
		<Field
			className="parameter-field"
			label={
				<span className="parameter-label">
					<span>
						{label}
						{parameter.required && (
							<span className="parameter-label__required"> *</span>
						)}
					</span>
					{!parameter.mutable && (
						<StatusPill
							tone="warning"
							icon="alert"
							title="Cannot change after the workspace is created."
						>
							Immutable
						</StatusPill>
					)}
					{parameter.ephemeral && (
						<StatusPill
							tone="success"
							icon="history"
							title="Resets to the default on restart."
						>
							Ephemeral
						</StatusPill>
					)}
					{required && (
						<StatusPill tone="danger" title={required.summary}>
							Required
						</StatusPill>
					)}
				</span>
			}
			htmlFor={id}
			description={parameter.description || undefined}
			descriptionId={descriptionId}
			error={
				diagnostics.length > 0 ? (
					<Diagnostics diagnostics={diagnostics} />
				) : undefined
			}
			errorId={diagnosticsId}
		>
			<ParameterControl
				{...props}
				id={id}
				label={label}
				describedBy={
					[
						parameter.description && descriptionId,
						diagnostics.length > 0 && diagnosticsId,
					]
						.filter(Boolean)
						.join(" ") || undefined
				}
				invalid={parameter.diagnostics.some((d) => d.severity === "error")}
			/>
		</Field>
	);
}

function ParameterControl({
	parameter,
	value,
	disabled,
	onChange,
	id,
	label,
	describedBy,
	invalid,
}: ParameterControlProps): React.JSX.Element | null {
	const control = {
		id,
		disabled,
		"aria-describedby": describedBy,
		"aria-invalid": invalid || undefined,
	};
	const text = {
		...control,
		value,
		onChange,
		placeholder: parameter.styling.placeholder,
	};
	const options = parameter.options.map((option) => ({
		value: option.value.value,
		label: option.name || option.value.value,
		description: option.description || undefined,
	}));

	switch (parameter.form_type) {
		case "error":
			return null;
		case "checkbox":
		case "switch":
			return (
				<Checkbox
					{...control}
					aria-label={parameter.styling.label ? undefined : label}
					checked={value === "true"}
					onChange={(checked) => onChange(String(checked))}
				>
					{parameter.styling.label}
				</Checkbox>
			);
		case "dropdown":
		case "radio":
			return (
				<Select
					items={options}
					value={value || null}
					onValueChange={(next) => onChange(next ?? "")}
					disabled={disabled}
				>
					<SelectTrigger {...control} aria-label={label}>
						<SelectValue
							placeholder={parameter.styling.placeholder || "Select option"}
						/>
					</SelectTrigger>
					<SelectContent>
						{options.map((option) => (
							<SelectItem
								key={option.value}
								value={option.value}
								description={option.description}
							>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			);
		case "multi-select": {
			const selected = parseMultiSelectValue(value) ?? [];
			return (
				<div role="group" aria-label={label} className="parameter-options">
					{options.map((option) => (
						<Checkbox
							key={option.value}
							disabled={disabled}
							checked={selected.includes(option.value)}
							onChange={(checked) =>
								onChange(
									JSON.stringify(
										checked
											? [...selected, option.value]
											: selected.filter((v) => v !== option.value),
									),
								)
							}
						>
							{option.label}
						</Checkbox>
					))}
				</div>
			);
		}
		case "textarea":
			return <Textarea {...text} />;
		case "":
		case "input":
		case "slider":
		case "tag-select": {
			if (parameter.type === "number") {
				const { validation_min: min, validation_max: max } =
					parameter.validations[0] ?? {};
				return (
					<Input
						{...text}
						type="number"
						min={min ?? undefined}
						max={max ?? undefined}
					/>
				);
			}
			return parameter.styling.mask_input ? (
				<PasswordInput {...text} />
			) : (
				<Input {...text} />
			);
		}
	}
}
