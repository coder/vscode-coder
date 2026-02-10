import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	render,
	type RenderOptions,
	type RenderResult,
} from "@testing-library/react";

import type { ReactElement, ReactNode } from "react";

export function QueryWrapper({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { mutations: { retry: false } } })
			}
		>
			{children}
		</QueryClientProvider>
	);
}

export function renderWithQuery(
	ui: ReactElement,
	options?: Omit<RenderOptions, "wrapper">,
): RenderResult {
	return render(ui, { wrapper: QueryWrapper, ...options });
}
