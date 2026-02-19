import { getState, setState } from "@repo/webview-shared";
import { useState } from "react";

import type { Task, TaskTemplate } from "@repo/shared";

export interface PersistedState {
	tasks: readonly Task[] | null;
	templates: readonly TaskTemplate[] | null;
	createExpanded: boolean;
	historyExpanded: boolean;
}

export function usePersistedState() {
	const [restored] = useState(() => getState<PersistedState>());

	return {
		initialTasks: restored?.tasks,
		initialTemplates: restored?.templates,
		initialCreateExpanded: restored?.createExpanded ?? true,
		initialHistoryExpanded: restored?.historyExpanded ?? true,
		save: (state: PersistedState) => setState(state),
	};
}
