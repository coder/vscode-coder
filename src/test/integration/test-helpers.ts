import * as vscode from "vscode";

/**
 * Integration test helpers that don't rely on Vitest
 */

interface MockFunction {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(...args: any[]): any;
	called: boolean;
	callCount: number;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	calls: any[][];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	mockReturnValue: (value: any) => void;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	mockImplementation: (impl: (...args: any[]) => any) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockFunction(defaultReturn?: any): MockFunction {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let implementation: ((...args: any[]) => any) | undefined;
	let returnValue = defaultReturn;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const fn = function (...args: any[]) {
		fn.called = true;
		fn.callCount++;
		fn.calls.push(args);

		if (implementation) {
			return implementation(...args);
		}
		return returnValue;
	} as MockFunction;

	fn.called = false;
	fn.callCount = 0;
	fn.calls = [];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	fn.mockReturnValue = (value: any) => {
		returnValue = value;
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	fn.mockImplementation = (impl: (...args: any[]) => any) => {
		implementation = impl;
	};

	return fn;
}

/**
 * Create a mock InputBox for integration tests
 */
export function createIntegrationMockInputBox(
	overrides: Partial<vscode.InputBox> = {},
): vscode.InputBox & {
	simulateUserInput: (value: string) => void;
	simulateAccept: () => void;
	simulateHide: () => void;
} {
	const acceptListeners: Array<() => void> = [];
	const hideListeners: Array<() => void> = [];
	const changeListeners: Array<(value: string) => void> = [];

	let currentValue = "";

	const inputBox = {
		value: currentValue,
		placeholder: "",
		password: false,
		prompt: "",
		title: "",
		step: undefined,
		totalSteps: undefined,
		enabled: true,
		busy: false,
		ignoreFocusOut: false,
		buttons: [],
		validationMessage: undefined,

		show: createMockFunction(),
		hide: createMockFunction(() => {
			hideListeners.forEach((listener) => listener());
		}),
		dispose: createMockFunction(),

		onDidAccept: (listener: () => void) => {
			acceptListeners.push(listener);
			return { dispose: () => {} };
		},
		onDidHide: (listener: () => void) => {
			hideListeners.push(listener);
			return { dispose: () => {} };
		},
		onDidChangeValue: (listener: (value: string) => void) => {
			changeListeners.push(listener);
			return { dispose: () => {} };
		},
		onDidTriggerButton: () => ({ dispose: () => {} }),

		// Automation methods
		simulateUserInput: (value: string) => {
			currentValue = value;
			inputBox.value = value;
			changeListeners.forEach((listener) => listener(value));
		},
		simulateAccept: () => {
			acceptListeners.forEach((listener) => listener());
		},
		simulateHide: () => {
			inputBox.hide();
		},

		...overrides,
	};

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return inputBox as any;
}

/**
 * Create a mock QuickPick for integration tests
 */
export function createIntegrationMockQuickPick<T extends vscode.QuickPickItem>(
	overrides: Partial<vscode.QuickPick<T>> = {},
): vscode.QuickPick<T> & {
	simulateUserInput: (value: string) => void;
	simulateItemSelection: (itemOrIndex: T | number) => void;
	simulateAccept: () => void;
	simulateHide: () => void;
} {
	const acceptListeners: Array<() => void> = [];
	const hideListeners: Array<() => void> = [];
	const changeValueListeners: Array<(value: string) => void> = [];
	const changeSelectionListeners: Array<(items: readonly T[]) => void> = [];
	const changeActiveListeners: Array<(items: readonly T[]) => void> = [];

	let currentValue = "";
	let currentItems: T[] = [];
	let selectedItems: T[] = [];
	let activeItems: T[] = [];

	const quickPick = {
		value: currentValue,
		placeholder: "",
		items: currentItems,
		canSelectMany: false,
		matchOnDescription: false,
		matchOnDetail: false,
		title: "",
		step: undefined,
		totalSteps: undefined,
		enabled: true,
		busy: false,
		ignoreFocusOut: false,
		selectedItems: selectedItems,
		activeItems: activeItems,
		buttons: [],

		show: createMockFunction(),
		hide: createMockFunction(() => {
			hideListeners.forEach((listener) => listener());
		}),
		dispose: createMockFunction(),

		onDidAccept: (listener: () => void) => {
			acceptListeners.push(listener);
			return { dispose: () => {} };
		},
		onDidHide: (listener: () => void) => {
			hideListeners.push(listener);
			return { dispose: () => {} };
		},
		onDidChangeValue: (listener: (value: string) => void) => {
			changeValueListeners.push(listener);
			return { dispose: () => {} };
		},
		onDidChangeSelection: (listener: (items: readonly T[]) => void) => {
			changeSelectionListeners.push(listener);
			return { dispose: () => {} };
		},
		onDidChangeActive: (listener: (items: readonly T[]) => void) => {
			changeActiveListeners.push(listener);
			return { dispose: () => {} };
		},
		onDidTriggerButton: () => ({ dispose: () => {} }),
		onDidTriggerItemButton: () => ({ dispose: () => {} }),

		// Automation methods
		simulateUserInput: (value: string) => {
			currentValue = value;
			quickPick.value = value;
			changeValueListeners.forEach((listener) => listener(value));
		},
		simulateItemSelection: (itemOrIndex: T | number) => {
			const item =
				typeof itemOrIndex === "number"
					? currentItems[itemOrIndex]
					: itemOrIndex;
			if (item) {
				selectedItems = [item];
				activeItems = [item];
				quickPick.selectedItems = selectedItems;
				quickPick.activeItems = activeItems;
				changeSelectionListeners.forEach((listener) => listener(selectedItems));
				changeActiveListeners.forEach((listener) => listener(activeItems));
			}
		},
		simulateAccept: () => {
			acceptListeners.forEach((listener) => listener());
		},
		simulateHide: () => {
			quickPick.hide();
		},

		...overrides,
	};

	// Override items setter to update internal state
	Object.defineProperty(quickPick, "items", {
		get: () => currentItems,
		set: (items: T[]) => {
			currentItems = items;
		},
	});

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return quickPick as any;
}
