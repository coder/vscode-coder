import "../index.css";

import type { Decorator } from "@storybook/react";

/**
 * Injects the tasks package CSS into the Storybook preview.
 * Add to `decorators` in any story that renders tasks components.
 */
export const withTasksStyles: Decorator = (Story) => Story();
