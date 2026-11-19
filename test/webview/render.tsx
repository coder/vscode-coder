import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	render,
	type RenderOptions,
	type RenderResult,
} from "@testing-library/react";
import { useState, type ReactElement, type ReactNode } from "react";

/** One client per mount, so re-renders keep the cache. */
export function QueryWrapper({ children }: { children: ReactNode }) {
	const [client] = useState(
		() => new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
	);
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function renderWithQuery(
	ui: ReactElement,
	options?: Omit<RenderOptions, "wrapper">,
): RenderResult {
	return render(ui, { wrapper: QueryWrapper, ...options });
}
