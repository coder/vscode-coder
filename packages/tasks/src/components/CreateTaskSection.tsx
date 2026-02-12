import { logger } from "@repo/webview-shared/logger";
import { useMutation } from "@tanstack/react-query";
import {
	VscodeOption,
	VscodeSingleSelect,
} from "@vscode-elements/react-elements";
import { useState } from "react";

import { useTasksApi } from "../hooks/useTasksApi";

import { PromptInput } from "./PromptInput";

import type { CreateTaskParams, TaskTemplate } from "@repo/shared";

interface CreateTaskSectionProps {
	templates: readonly TaskTemplate[];
}

export function CreateTaskSection({ templates }: CreateTaskSectionProps) {
	const api = useTasksApi();
	const [prompt, setPrompt] = useState("");
	const [templateId, setTemplateId] = useState(templates[0]?.id || "");
	const [presetId, setPresetId] = useState("");

	const { mutate, isPending, error } = useMutation({
		mutationFn: (params: CreateTaskParams) => api.createTask(params),
		onSuccess: () => setPrompt(""),
	});

	const selectedTemplate = templates.find((t) => t.id === templateId);
	const presets = selectedTemplate?.presets ?? [];
	const canSubmit = prompt.trim().length > 0 && selectedTemplate && !isPending;

	const handleSubmit = () => {
		if (!canSubmit) {
			logger.warn("handleSubmit called while submission is disabled");
			return;
		}
		mutate({
			templateVersionId: selectedTemplate.activeVersionId,
			prompt: prompt.trim(),
			presetId: presetId || undefined,
		});
	};

	return (
		<div className="create-task-section">
			<PromptInput
				value={prompt}
				onChange={setPrompt}
				onSubmit={handleSubmit}
				loading={isPending}
			/>
			{error && <div className="create-task-error">{error.message}</div>}
			<div className="create-task-options">
				<div className="option-row">
					<span className="option-label">Template:</span>
					<VscodeSingleSelect
						className="option-select"
						value={templateId}
						onChange={(e) => {
							setTemplateId((e.target as HTMLSelectElement).value);
							setPresetId("");
						}}
						disabled={isPending}
					>
						{templates.map((template) => (
							<VscodeOption key={template.id} value={template.id}>
								{template.displayName}
							</VscodeOption>
						))}
					</VscodeSingleSelect>
				</div>
				{presets.length > 0 && (
					<div className="option-row">
						<span className="option-label">Preset:</span>
						<VscodeSingleSelect
							className="option-select"
							value={presetId}
							onChange={(e) =>
								setPresetId((e.target as HTMLSelectElement).value)
							}
							disabled={isPending}
						>
							<VscodeOption value="">No preset</VscodeOption>
							{presets.map((preset) => (
								<VscodeOption key={preset.id} value={preset.id}>
									{preset.name}
									{preset.isDefault ? " (Default)" : ""}
								</VscodeOption>
							))}
						</VscodeSingleSelect>
					</div>
				)}
			</div>
		</div>
	);
}
