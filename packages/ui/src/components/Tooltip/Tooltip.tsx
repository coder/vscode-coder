import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cx } from "#cx";

import "./Tooltip.css";

import type { ComponentPropsWithRef, ReactNode } from "react";

export interface TooltipProps extends Omit<
	ComponentPropsWithRef<typeof TooltipPrimitive.Content>,
	"content"
> {
	content: ReactNode;
	/** The trigger element; must accept a forwarded ref (asChild). */
	children: ReactNode;
	/** Show delay in ms. Defaults to VS Code's workbench.hover.delay. */
	delayDuration?: number;
}

export function Tooltip({
	content,
	children,
	className,
	sideOffset = 4,
	delayDuration = 500,
	...props
}: TooltipProps): React.JSX.Element {
	return (
		<TooltipPrimitive.Provider delayDuration={delayDuration}>
			<TooltipPrimitive.Root>
				<TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
				<TooltipPrimitive.Portal>
					<TooltipPrimitive.Content
						{...props}
						sideOffset={sideOffset}
						className={cx("ui-tooltip", className)}
					>
						{content}
					</TooltipPrimitive.Content>
				</TooltipPrimitive.Portal>
			</TooltipPrimitive.Root>
		</TooltipPrimitive.Provider>
	);
}
