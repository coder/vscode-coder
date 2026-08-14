import { Slot } from "@radix-ui/react-slot";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
	createContext,
	use,
	type ComponentProps,
	type ComponentPropsWithRef,
	type PointerEvent,
	type ReactNode,
} from "react";

import { cx } from "#cx";

import "../overlay.css";

import "./Tooltip.css";

export type TooltipProviderProps = ComponentProps<
	typeof TooltipPrimitive.Provider
>;

/** VS Code's `workbench.hover.delay`. */
const DEFAULT_DELAY_MS = 500;

/**
 * App-level tooltip context; `Tooltip` throws without one. Sharing a single
 * provider lets a pointer moving between nearby triggers skip the show delay,
 * like native hovers.
 */
export function TooltipProvider({
	delayDuration = DEFAULT_DELAY_MS,
	...props
}: TooltipProviderProps): React.JSX.Element {
	return (
		<TooltipContext value={delayDuration}>
			<TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />
		</TooltipContext>
	);
}

const TooltipContext = createContext<number | null>(null);

/** Owns tooltips without forcing a provider on consumers; defers to any app-level one. */
export function TooltipScope({ children }: { children: ReactNode }): ReactNode {
	return use(TooltipContext) === null ? (
		<TooltipProvider>{children}</TooltipProvider>
	) : (
		children
	);
}

/** The surrounding provider's show delay, for surfaces that time their own. */
export function useTooltipDelay(): number {
	return use(TooltipContext) ?? DEFAULT_DELAY_MS;
}

export interface HoverTarget {
	readonly content: ReactNode;
	readonly element: HTMLElement;
}

/** `immediate` skips the show delay. */
export type HoverDelegate = (
	target: HoverTarget | undefined,
	immediate?: boolean,
) => void;

const HoverDelegateContext = createContext<HoverDelegate | undefined>(
	undefined,
);

/**
 * Hands every `Tooltip` inside to one shared bubble, the way a VS Code list
 * serves its rows and their action bars from a single hover widget. Pass
 * `undefined` to hand them back.
 */
export function HoverDelegateScope({
	delegate,
	children,
}: {
	delegate: HoverDelegate | undefined;
	children: ReactNode;
}): React.JSX.Element {
	return (
		<HoverDelegateContext value={delegate}>{children}</HoverDelegateContext>
	);
}

export interface TooltipProps extends Omit<
	ComponentPropsWithRef<typeof TooltipPrimitive.Content>,
	"content"
> {
	content: ReactNode;
	/** The trigger element; must accept a forwarded ref (asChild). */
	children: ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

/** Hover bubble matching the native hover widget; requires a `TooltipProvider` ancestor. */
export function Tooltip({
	content,
	children,
	className,
	open,
	onOpenChange,
	...props
}: TooltipProps): React.JSX.Element {
	const delegate = use(HoverDelegateContext);
	if (delegate) {
		return (
			<Slot
				onPointerEnter={(event: PointerEvent<HTMLElement>) =>
					delegate({ content, element: event.currentTarget })
				}
				onPointerLeave={() => delegate(undefined)}
			>
				{children}
			</Slot>
		);
	}
	return (
		<TooltipPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
			<TooltipPrimitive.Portal>
				<TooltipPrimitive.Content
					// Native sits a hover 2px into the bottom edge of its target.
					side="bottom"
					sideOffset={-2}
					align="center"
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
