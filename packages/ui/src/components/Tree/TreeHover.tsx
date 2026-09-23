import {
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
	type ReactNode,
	type RefObject,
} from "react";

import {
	AnchoredHover,
	HoverDelegateContext,
	useTooltipDelay,
	type HoverAnchor,
	type HoverDelegate,
	type HoverTarget,
} from "../Tooltip/Tooltip";

const GRACE_MS = 100;

/** Native reopens with no delay this soon after hiding, and only for a dense
    cluster of targets such as an action bar. */
const INSTANT_MS = 200;
const DENSE_CLUSTER = ".ui-tree-item__action";

/** setupCustomHover offsets a cursor-placed hover by this much. */
const CURSOR_OFFSET_PX = 10;

const ROW = ".ui-tree-item";

export type TreeHoverControl = RefObject<HoverDelegate | undefined>;

interface Shown extends HoverTarget {
	readonly anchor: HoverAnchor;
	readonly align: "center" | "start";
}

/** One bubble for the whole tree, so rows only attach pointer handlers. */
export function TreeHover({
	children,
	treeRef,
	controlRef,
}: {
	children: ReactNode;
	treeRef: RefObject<HTMLDivElement | null>;
	controlRef: TreeHoverControl;
}): React.JSX.Element {
	const delay = useTooltipDelay();
	const [shown, setShown] = useState<Shown>();
	const openRef = useRef(false);
	const hiddenAtRef = useRef(0);
	const clusterRef = useRef<Element | null>(null);
	const pointerXRef = useRef<number | undefined>(undefined);
	const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	const hide = (): void => {
		clearTimeout(timerRef.current);
		if (openRef.current) hiddenAtRef.current = Date.now();
		openRef.current = false;
		setShown(undefined);
	};

	// Native centers on an action bar button and follows the cursor along a row,
	// measuring the row so taller content cannot push the bubble off it.
	const show = (target: HoverTarget, atPointer = true): void => {
		const tree = treeRef.current;
		const targetRect = target.element.getBoundingClientRect();
		if (
			!tree?.contains(target.element) ||
			targetRect.width <= 0 ||
			targetRect.height <= 0
		) {
			hide();
			return;
		}
		const cluster = target.element.closest(DENSE_CLUSTER);
		const bounds = tree.getBoundingClientRect();
		const rect = cluster
			? targetRect
			: (target.element.closest(ROW) ?? target.element).getBoundingClientRect();
		const cursorX = cluster || !atPointer ? undefined : pointerXRef.current;
		const top = rect.top - bounds.top;
		const left =
			(cursorX === undefined ? rect.left : cursorX + CURSOR_OFFSET_PX) -
			bounds.left;
		const width = cursorX === undefined ? rect.width : 0;
		openRef.current = true;
		clusterRef.current = cluster;
		setShown({
			...target,
			// Relative to the tree, so the bubble follows it when it scrolls.
			anchor: {
				contextElement: tree,
				getBoundingClientRect: () => {
					const now = tree.getBoundingClientRect();
					return new DOMRect(
						now.left + left,
						now.top + top,
						width,
						rect.height,
					);
				},
			},
			align: cursorX === undefined ? "center" : "start",
		});
	};

	const setTarget: HoverDelegate = (target, immediate = false) => {
		clearTimeout(timerRef.current);
		if (!target?.content) {
			if (immediate) {
				hide();
				return;
			}
			timerRef.current = setTimeout(hide, GRACE_MS);
			return;
		}
		const cluster = target.element.closest(DENSE_CLUSTER);
		const recent =
			openRef.current || Date.now() - hiddenAtRef.current < INSTANT_MS;
		if (immediate || (recent && cluster && cluster === clusterRef.current)) {
			show(target, !immediate);
			return;
		}
		hide();
		timerRef.current = setTimeout(() => show(target), delay);
	};

	useImperativeHandle(controlRef, () => setTarget, [setTarget]);
	useEffect(() => () => clearTimeout(timerRef.current), []);

	useEffect(() => {
		const tree = treeRef.current;
		if (!tree) return;
		const track = (event: PointerEvent): void => {
			pointerXRef.current = event.clientX;
		};
		tree.addEventListener("pointermove", track, { passive: true });
		// Capture also dismisses hovers when an action stops propagation.
		tree.addEventListener("pointerdown", hide, true);
		return () => {
			tree.removeEventListener("pointermove", track);
			tree.removeEventListener("pointerdown", hide, true);
		};
	}, [treeRef, hide]);

	return (
		<HoverDelegateContext value={setTarget}>
			{children}
			{shown ? (
				<AnchoredHover
					content={shown.content}
					anchor={shown.anchor}
					align={shown.align}
					onOpenChange={(open) => {
						if (!open) hide();
					}}
					onPointerEnter={() => clearTimeout(timerRef.current)}
					onPointerLeave={() => setTarget(undefined)}
				/>
			) : null}
		</HoverDelegateContext>
	);
}
