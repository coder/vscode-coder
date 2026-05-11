import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import type { Decorator } from "@storybook/react-vite";

function QueryClientDecorator({ children }: { children: React.ReactNode }) {
	const [client] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						retry: false,
						staleTime: Infinity,
					},
					mutations: {
						retry: false,
					},
				},
			}),
	);

	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Decorator that wraps stories with a QueryClientProvider.
 * Use this for components that use React Query hooks (useQuery, useMutation, etc.)
 */
export const withQueryClient: Decorator = (Story) => (
	<QueryClientDecorator>
		<Story />
	</QueryClientDecorator>
);
