import {
	VscodeIcon,
	VscodeOption,
	VscodeProgressRing,
	VscodeSingleSelect,
} from "@vscode-elements/react-elements";
import { useEffect, useState } from "react";

import { useTasksApi } from "../hooks/useTasksApi";

import type { TaskTemplate } from "@repo/shared";

interface CreateTaskSectionProps {
	templates: TaskTemplate[];
}

export function CreateTaskSection({ templates }: CreateTaskSectionProps) {
	const api = useTasksApi();
	const [prompt, setPrompt] = useState("");
	const [templateId, setTemplateId] = useState(templates[0]?.id || "");
	const [presetId, setPresetId] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const selectedTemplate = templates.find((t) => t.id === templateId);
	const presets = selectedTemplate?.presets ?? [];

	// Sync templateId when templates prop changes
	useEffect(() => {
		if (templates.length > 0 && !templates.find((t) => t.id === templateId)) {
			setTemplateId(templates[0].id);
			setPresetId("");
		}
	}, [templates, templateId]);

	const handleTemplateChange = (e: Event) => {
		const target = e.target as HTMLSelectElement;
		const newTemplateId = target.value;
		setTemplateId(newTemplateId);
		setPresetId("");
	};

	const handlePresetChange = (e: Event) => {
		const target = e.target as HTMLSelectElement;
		setPresetId(target.value);
	};

	const handleSubmit = async () => {
		if (!prompt.trim() || !selectedTemplate || isSubmitting) return;

		setIsSubmitting(true);
		setError(null);
		try {
			await api.createTask({
				templateVersionId: selectedTemplate.activeVersionId,
				prompt: prompt.trim(),
				presetId: presetId || undefined,
			});
			setPrompt("");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create task");
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !isSubmitting) {
			e.preventDefault();
			void handleSubmit();
		}
	};

	const canSubmit =
		prompt.trim().length > 0 && selectedTemplate && !isSubmitting;

	return (
		<div className="create-task-section">
			<div className="prompt-input-container">
				<textarea
					className="prompt-input"
					placeholder="Prompt your AI agent to start a task..."
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
					onKeyDown={handleKeyDown}
					disabled={isSubmitting}
				/>
				<div className="prompt-send-button">
					{isSubmitting ? (
						<VscodeProgressRing />
					) : (
						<VscodeIcon
							actionIcon
							name="send"
							label="Send"
							onClick={canSubmit ? () => void handleSubmit() : undefined}
							className={!canSubmit ? "disabled" : ""}
						/>
					)}
				</div>
			</div>
			{error && <div className="create-task-error">{error}</div>}
			<div className="create-task-options">
				<div className="option-row">
					<span className="option-label">Template:</span>
					<VscodeSingleSelect
						className="option-select"
						value={templateId}
						onChange={handleTemplateChange}
						disabled={isSubmitting}
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
							onChange={handlePresetChange}
							disabled={isSubmitting}
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
