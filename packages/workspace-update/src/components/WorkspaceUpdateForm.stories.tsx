import { diagnostic, parameterOption, previewParameter } from "@repo/mocks";
import { fn } from "storybook/test";

import { WorkspaceUpdateForm } from "./WorkspaceUpdateForm";

import type { Meta, StoryObj } from "@storybook/react-vite";

const parameters = [
	previewParameter({
		name: "region",
		display_name: "Region",
		form_type: "dropdown",
		description: "Where the workspace runs.",
		required: true,
		options: [
			parameterOption("eu", "Frankfurt"),
			parameterOption("us", "Pittsburgh"),
		],
	}),
	previewParameter({
		name: "cpus",
		display_name: "CPU cores",
		type: "number",
		description: "Cores reserved for the workspace.",
		validations: [
			{
				validation_error: "",
				validation_regex: null,
				validation_min: 1,
				validation_max: 8,
				validation_monotonic: null,
			},
		],
	}),
	previewParameter({
		name: "image",
		display_name: "Base image",
		description: "The container image the workspace starts from.",
		mutable: false,
	}),
	previewParameter({
		name: "gpu",
		display_name: "GPU",
		form_type: "checkbox",
		styling: { label: "Attach a GPU to the workspace" },
	}),
	previewParameter({
		name: "tools",
		display_name: "Tools",
		form_type: "multi-select",
		type: "list(string)",
		description: "Installed on first start.",
		options: [
			parameterOption("docker", "Docker"),
			parameterOption("node", "Node.js"),
			parameterOption("go", "Go"),
		],
	}),
	previewParameter({
		name: "token",
		display_name: "Access token",
		styling: { mask_input: true },
	}),
	previewParameter({
		name: "notes",
		display_name: "Notes",
		form_type: "textarea",
		ephemeral: true,
	}),
];

const meta: Meta<typeof WorkspaceUpdateForm> = {
	title: "WorkspaceUpdate/WorkspaceUpdateForm",
	component: WorkspaceUpdateForm,
	args: {
		workspaceName: "alice/dev",
		restart: true,
		evaluation: { id: 0, parameters, diagnostics: [] },
		values: { region: "eu", cpus: "4", image: "ubuntu" },
		evaluating: false,
		canSubmit: true,
		onChange: fn(),
		onSubmit: fn(),
		onCancel: fn(),
	},
	// Editor tab width.
	parameters: { rootWidth: "800px" },
};

export default meta;
type Story = StoryObj<typeof WorkspaceUpdateForm>;

export const Default: Story = {};

export const WithErrors: Story = {
	args: {
		evaluation: {
			id: 0,
			parameters: parameters.map((p) =>
				p.name === "cpus"
					? { ...p, diagnostics: [diagnostic("Must be at most 8")] }
					: p,
			),
			diagnostics: [
				diagnostic("The image list could not be refreshed", "warning"),
			],
		},
		values: { region: "eu", cpus: "16", image: "ubuntu" },
		canSubmit: false,
	},
};
