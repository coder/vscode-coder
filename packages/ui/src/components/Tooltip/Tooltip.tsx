import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { useRender } from "@base-ui/react/use-render";
import {
	createContext,
	use,
	useId,
	useState,
	type ComponentProps,
	type ComponentPropsWithRef,
	type PointerEvent,
	type ReactElement,
	type ReactNode,
} from "react";

import { cx, type Styled } from "#cx";

import "../overlay.css";

import "./Tooltip.css";

export type TooltipProviderProps = ComponentProps<
	typeof TooltipPrimitive.Provider
>;

/** VS Code's `workbench.hover.delay`. */
const DEFAULT_DELAY_MS = 500;

/** Mount one per app so moving between nearby triggers skips the delay. */
export function TooltipProvider({
	delay = DEFAULT_DELAY_MS,
	...props
}: TooltipProviderProps): React.JSX.Element {
	return (
		<TooltipContext value={delay}>
			<TooltipPrimitive.Provider delay={delay} {...props} />
		</TooltipContext>
	);
}

const TooltipContext = createContext(DEFAULT_DELAY_MS);

export function useTooltipDelay(): number {
	return use(TooltipContext);
}

export interface HoverTarget {
	readonly content: ReactNode;
	readonly element: HTMLElement;
}

/** `immediate` skips the show delay or dismisses without a leave grace period. */
export type HoverDelegate = (
	target: HoverTarget | undefined,
	immediate?: boolean,
) => void;

/** Hands every `Tooltip` inside to one shared bubble. */
export const HoverDelegateContext = createContext<HoverDelegate | undefined>(
	undefined,
);

type PositionerProps = ComponentPropsWithRef<
	typeof TooltipPrimitive.Positioner
>;

export interface TooltipProps extends Omit<
	Styled<ComponentPropsWithRef<typeof TooltipPrimitive.Popup>>,
	"content" | "children"
> {
	content: ReactNode;
	/** The trigger element; must accept a forwarded ref. */
	children: ReactElement;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

function DelegatedTooltip({
	content,
	children,
	delegate,
}: {
	content: ReactNode;
	children: ReactElement;
	delegate: HoverDelegate;
}): ReactNode {
	return useRender({
		render: children,
		props: {
			onPointerEnter: (event: PointerEvent<HTMLElement>) =>
				delegate({ content, element: event.currentTarget }),
			onPointerLeave: () => delegate(undefined),
		},
	});
}

export function Tooltip({
	content,
	children,
	...props
}: TooltipProps): ReactNode {
	const delegate = use(HoverDelegateContext);
	if (delegate) {
		return (
			<DelegatedTooltip content={content} delegate={delegate}>
				{children}
			</DelegatedTooltip>
		);
	}
	return (
		<HoverBubble content={content} {...props}>
			{children}
		</HoverBubble>
	);
}

function HoverBubble({
	content,
	children,
	open,
	onOpenChange,
	...props
}: TooltipProps): React.JSX.Element {
	const contentId = useId();
	const delay = useTooltipDelay();
	const [openedItself, setOpenedItself] = useState(false);
	return (
		<TooltipPrimitive.Root
			open={open}
			onOpenChange={(next) => {
				setOpenedItself(next);
				onOpenChange?.(next);
			}}
		>
			<TooltipPrimitive.Trigger
				render={children}
				delay={delay}
				aria-describedby={(open ?? openedItself) ? contentId : undefined}
			/>
			<HoverPopup id={contentId} content={content} {...props} />
		</TooltipPrimitive.Root>
	);
}

export type HoverAnchor = NonNullable<PositionerProps["anchor"]>;

type HoverPopupProps = Omit<
	TooltipProps,
	"children" | "open" | "onOpenChange"
> & {
	anchor?: HoverAnchor;
	align?: PositionerProps["align"];
};

/** An open bubble at `anchor`, for callers that time their own hovers. */
export function AnchoredHover({
	onOpenChange,
	...props
}: HoverPopupProps &
	Pick<TooltipProps, "onOpenChange"> & {
		anchor: HoverAnchor;
	}): React.JSX.Element {
	return (
		<TooltipPrimitive.Root open onOpenChange={onOpenChange}>
			<HoverPopup {...props} />
		</TooltipPrimitive.Root>
	);
}

function HoverPopup({
	content,
	className,
	align = "center",
	anchor,
	...props
}: HoverPopupProps): React.JSX.Element {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Positioner
				// Fixed gets its own layer, which keeps text antialiasing greyscale.
				positionMethod="fixed"
				anchor={anchor}
				// Native sits a hover 2px into the bottom edge of its target.
				side="bottom"
				sideOffset={-2}
				align={align}
				collisionPadding={8}
			>
				<TooltipPrimitive.Popup
					role="tooltip"
					{...props}
					className={cx("ui-overlay ui-tooltip", className)}
				>
					{content}
				</TooltipPrimitive.Popup>
			</TooltipPrimitive.Positioner>
		</TooltipPrimitive.Portal>
	);
}
