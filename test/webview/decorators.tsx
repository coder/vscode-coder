import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Decorator } from "@storybook/react";
import { useRef } from "react";

/**
 * Decorator that wraps stories with a QueryClientProvider.
 * Use this for components that use React Query hooks (useQuery, useMutation, etc.)
 */
export const withQueryClient: Decorator = (Story) => {
	const clientRef = useRef<QueryClient | null>(null);

	if (!clientRef.current) {
		clientRef.current = new QueryClient({
			defaultOptions: {
				queries: {
					retry: false,
					staleTime: Infinity,
				},
				mutations: {
					retry: false,
				},
			},
		});
	}

	return (
		<QueryClientProvider client={clientRef.current}>
			<Story />
		</QueryClientProvider>
	);
};
