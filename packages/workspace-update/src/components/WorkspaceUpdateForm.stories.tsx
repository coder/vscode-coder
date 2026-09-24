import { PIXEL_ALL_THEMES } from "@repo/ui/storybook";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { WorkspaceUpdateForm } from "./WorkspaceUpdateForm";

import type { WorkspaceUpdateInit } from "@repo/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type {
	DynamicParametersResponse,
	PreviewParameter,
} from "coder/site/src/api/typesGenerated";

const init: WorkspaceUpdateInit = {
	workspaceName: "alice/dev",
	values: { region: "eu", cpus: "4", image: "ubuntu" },
	restart: true,
};

function parameter(
	overrides: Partial<PreviewParameter> &
		Pick<PreviewParameter, "name" | "form_type">,
): PreviewParameter {
	return {
		display_name: overrides.name,
		description: "",
		type: "string",
		styling: {},
		mutable: true,
		default_value: { valid: true, value: "" },
		value: { valid: true, value: "" },
		icon: "",
		options: [],
		validations: [],
		required: false,
		order: 0,
		ephemeral: false,
		diagnostics: [],
		...overrides,
	};
}

function option(value: string, description = "") {
	return { name: value, description, value: { valid: true, value }, icon: "" };
}

const parameters = [
	parameter({
		name: "region",
		form_type: "dropdown",
		description: "Where the workspace runs.",
		required: true,
		options: [option("eu", "Frankfurt"), option("us", "Pittsburgh")],
	}),
	parameter({ name: "cpus", form_type: "input", type: "number" }),
	parameter({ name: "image", form_type: "input", mutable: false }),
	parameter({ name: "gpu", form_type: "checkbox" }),
	parameter({
		name: "tools",
		form_type: "multi-select",
		type: "list(string)",
		options: [option("docker"), option("node"), option("go")],
	}),
	parameter({
		name: "token",
		form_type: "input",
		styling: { mask_input: true },
	}),
	parameter({ name: "notes", form_type: "textarea", ephemeral: true }),
];

function withEvaluation(response: Omit<DynamicParametersResponse, "id">) {
	return (Story: () => React.JSX.Element) => {
		const client = new QueryClient({
			defaultOptions: { queries: { staleTime: Infinity } },
		});
		client.setQueryData(["evaluate", init.values], { id: 0, ...response });
		return (
			<QueryClientProvider client={client}>
				<Story />
			</QueryClientProvider>
		);
	};
}

const meta: Meta<typeof WorkspaceUpdateForm> = {
	title: "WorkspaceUpdate/WorkspaceUpdateForm",
	component: WorkspaceUpdateForm,
	args: { init },
	// An editor tab, not the sidebar.
	parameters: { pixel: PIXEL_ALL_THEMES, rootWidth: "800px" },
};

export default meta;
type Story = StoryObj<typeof WorkspaceUpdateForm>;

export const Default: Story = {
	decorators: [withEvaluation({ parameters, diagnostics: [] })],
};

export const WithErrors: Story = {
	decorators: [
		withEvaluation({
			parameters: parameters.map((p) =>
				p.name === "cpus"
					? {
							...p,
							diagnostics: [
								{
									severity: "error",
									summary: "Must be at most 8",
									detail: "",
									extra: { code: "" },
								},
							],
						}
					: p,
			),
			diagnostics: [
				{
					severity: "warning",
					summary: "The image list could not be refreshed",
					detail: "",
					extra: { code: "" },
				},
			],
		}),
	],
};
