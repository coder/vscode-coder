import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Decorator } from "@storybook/react";

/**
 * Decorator that wraps stories with a QueryClientProvider.
 * Use this for components that use React Query hooks (useQuery, useMutation, etc.)
 */
export const withQueryClient: Decorator = (Story) => {
	const queryClient = new QueryClient({
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

	return (
		<QueryClientProvider client={queryClient}>
			<Story />
		</QueryClientProvider>
	);
};
