import { useState } from "react";

import { WorkspaceUpdateForm } from "./WorkspaceUpdateForm";

import type { WorkspaceUpdateState } from "@repo/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";

const parameter = (
	name: string,
	formType: WorkspaceUpdateState["parameters"][number]["form_type"],
	options: ReadonlyArray<{
		name: string;
		value: string;
		description?: string;
	}> = [],
): WorkspaceUpdateState["parameters"][number] => ({
	name,
	display_name: name,
	description: `Configure ${name}.`,
	type: formType === "slider" ? "number" : "string",
	form_type: formType,
	styling: {},
	mutable: true,
	default_value: { valid: false, value: "" },
	value: { valid: false, value: "" },
	icon: "",
	options: options.map((option) => ({
		name: option.name,
		description: option.description ?? "",
		value: { valid: true, value: option.value },
		icon: "",
	})),
	validations: [],
	required: false,
	order: 0,
	ephemeral: false,
	diagnostics: [],
});

const state: WorkspaceUpdateState = {
	workspaceName: "dev",
	templateVersionId: "template-version-1",
	revision: 3,
	status: "ready",
	inputs: {
		region: "us-east",
		autoscale: "true",
		cores: "4",
		tags: '["team,blue", "staging"]',
		features: '["metrics"]',
	},
	locked: ["locked"],
	diagnostics: [],
	canSubmit: true,
	parameters: [
		parameter("region", "radio", [
			{ name: "US East", value: "us-east" },
			{ name: "Europe", value: "eu-west", description: "Frankfurt" },
		]),
		parameter("autoscale", "switch"),
		parameter("cores", "slider"),
		parameter("notes", "textarea"),
		parameter("features", "multi-select", [
			{ name: "Metrics", value: "metrics" },
			{ name: "Tracing", value: "tracing" },
		]),
		parameter("tags", "tag-select"),
		{ ...parameter("token", "input"), styling: { mask_input: true } },
		{ ...parameter("locked", "input"), mutable: false },
	],
};

function InteractiveForm(): React.JSX.Element {
	const [inputs, setInputs] = useState(state.inputs);
	return (
		<WorkspaceUpdateForm
			state={{ ...state, inputs }}
			onChange={({ name, value }) =>
				setInputs((current) => ({ ...current, [name]: value }))
			}
			onCancel={() => undefined}
			onRetry={() => undefined}
			onSubmit={() => undefined}
		/>
	);
}

const meta: Meta<typeof InteractiveForm> = {
	title: "Workspace Update/Form",
	component: InteractiveForm,
};

export default meta;
type Story = StoryObj<typeof InteractiveForm>;

export const Ready: Story = {};

export const Evaluating: Story = {
	render: () => (
		<WorkspaceUpdateForm
			state={{ ...state, status: "evaluating" }}
			onChange={() => undefined}
			onCancel={() => undefined}
			onRetry={() => undefined}
			onSubmit={() => undefined}
		/>
	),
};

export const Error: Story = {
	render: () => (
		<WorkspaceUpdateForm
			state={{
				...state,
				status: "error",
				parameters: [],
				error: "The template is unavailable.",
			}}
			onChange={() => undefined}
			onCancel={() => undefined}
			onRetry={() => undefined}
			onSubmit={() => undefined}
		/>
	),
};
