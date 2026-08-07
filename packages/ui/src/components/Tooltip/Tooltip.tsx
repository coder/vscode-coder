import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cx } from "#cx";

import "../overlay.css";

import "./Tooltip.css";

import type { ComponentProps, ComponentPropsWithRef, ReactNode } from "react";

export type TooltipProviderProps = ComponentProps<
	typeof TooltipPrimitive.Provider
>;

/**
 * App-level tooltip context; `Tooltip` throws without one. Sharing a single
 * provider lets a pointer moving between nearby triggers skip the show delay,
 * like native hovers. The default delay is VS Code's `workbench.hover.delay`.
 */
export function TooltipProvider(
	props: TooltipProviderProps,
): React.JSX.Element {
	return <TooltipPrimitive.Provider delayDuration={500} {...props} />;
}

export interface TooltipProps extends Omit<
	ComponentPropsWithRef<typeof TooltipPrimitive.Content>,
	"content"
> {
	content: ReactNode;
	/** The trigger element; must accept a forwarded ref (asChild). */
	children: ReactNode;
}

/** Hover bubble matching the native hover widget; requires a `TooltipProvider` ancestor. */
export function Tooltip({
	content,
	children,
	className,
	...props
}: TooltipProps): React.JSX.Element {
	return (
		<TooltipPrimitive.Root>
			<TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
			<TooltipPrimitive.Portal>
				<TooltipPrimitive.Content
					// Native hovers sit flush with the target, left-aligned
					align="start"
					collisionPadding={8}
					{...props}
					className={cx("ui-overlay ui-tooltip", className)}
				>
					{content}
				</TooltipPrimitive.Content>
			</TooltipPrimitive.Portal>
		</TooltipPrimitive.Root>
	);
}
