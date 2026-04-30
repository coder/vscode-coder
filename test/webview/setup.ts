import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Lit's dev build emits warnings we can't avoid (resolve.conditions is
// additive so we can't force the production bundle). Filter them out.
const originalWarn = globalThis.console.warn.bind(globalThis.console);
globalThis.console.warn = (...args: unknown[]) => {
	const msg = String(args[0]);
	if (msg.includes("Lit is in dev mode") || msg.includes("scheduled an update"))
		return;
	originalWarn(...args);
};

// Silences "codicons.css file must be included" warning from VscodeIcon.
document.head.appendChild(
	Object.assign(document.createElement("link"), {
		id: "vscode-codicon-stylesheet",
	}),
);

// jsdom doesn't provide ResizeObserver.
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};

// jsdom has no Canvas 2D; return a Proxy that accepts any prop read or method
// call. measureText and createLinearGradient must return real shapes because
// the caller reads fields off them.
const noop = () => undefined;
const stubCtx = new Proxy(
	{
		measureText: (s: string) => ({ width: s.length * 6 }),
		createLinearGradient: () => ({ addColorStop: noop }),
	},
	{
		get(target, prop, receiver) {
			if (prop in target) return Reflect.get(target, prop, receiver);
			// Return noop for any method/property the chart calls (ctx.beginPath,
			// ctx.moveTo, etc). Symbol lookups (Symbol.toPrimitive) stay undefined.
			return typeof prop === "string" ? noop : undefined;
		},
		set: () => true,
	},
);
HTMLCanvasElement.prototype.getContext = ((type: string) =>
	type === "2d" ? stubCtx : null) as HTMLCanvasElement["getContext"];

// VscodeSingleSelect fires internal slot-change events that read properties
// jsdom doesn't support (e.g. textContent of slotted elements). Suppress
// these uncaught errors from the third-party web component.
process.on("uncaughtException", (err: Error) => {
	const msg = err?.message ?? "";
	if (msg.includes("reading 'trim'") || msg.includes("reading 'unobserve'")) {
		return;
	}
	throw err;
});

// Form controls call setFormValue/setValidity which jsdom doesn't provide.
const originalAttachInternals = HTMLElement.prototype.attachInternals;
HTMLElement.prototype.attachInternals = function () {
	const internals = originalAttachInternals.call(this);
	if (!internals.setFormValue) {
		internals.setFormValue = vi.fn();
	}
	if (!internals.setValidity) {
		internals.setValidity = vi.fn();
	}
	return internals;
};
