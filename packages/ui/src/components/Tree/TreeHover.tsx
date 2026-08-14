import {
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
	type ReactNode,
	type RefObject,
} from "react";

import {
	HoverDelegateScope,
	Tooltip,
	useTooltipDelay,
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
	readonly top: number;
	readonly left: number;
	readonly width: number;
	readonly height: number;
	readonly align: "center" | "start";
}

/**
 * One hover for the whole tree, like the native list's shared widget: rows and
 * anything inside them report the element under the pointer, and an invisible
 * anchor moves to it.
 */
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
		if (!tree) return;
		const cluster = target.element.closest(DENSE_CLUSTER);
		const box = cluster
			? target.element
			: (target.element.closest(ROW) ?? target.element);
		const bounds = tree.getBoundingClientRect();
		const rect = box.getBoundingClientRect();
		const cursorX = cluster || !atPointer ? undefined : pointerXRef.current;
		openRef.current = true;
		clusterRef.current = cluster;
		setShown({
			...target,
			top: rect.top - bounds.top,
			left:
				(cursorX === undefined ? rect.left : cursorX + CURSOR_OFFSET_PX) -
				bounds.left,
			width: cursorX === undefined ? rect.width : 0,
			height: rect.height,
			align: cursorX === undefined ? "center" : "start",
		});
	};

	const setTarget: HoverDelegate = (target, immediate = false) => {
		clearTimeout(timerRef.current);
		if (!target?.content) {
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
		return () => tree.removeEventListener("pointermove", track);
	}, [treeRef]);

	return (
		<HoverDelegateScope delegate={setTarget}>
			{children}
			{/* Outside the scope, or the bubble would delegate to itself. */}
			<HoverDelegateScope delegate={undefined}>
				{shown ? (
					<Tooltip
						content={shown.content}
						align={shown.align}
						open
						onOpenChange={(open) => {
							if (!open) hide();
						}}
						onPointerEnter={() => clearTimeout(timerRef.current)}
						onPointerLeave={() => setTarget(undefined)}
					>
						<span
							aria-hidden="true"
							className="ui-tree-hover-anchor"
							style={{
								top: shown.top,
								left: shown.left,
								width: shown.width,
								height: shown.height,
							}}
						/>
					</Tooltip>
				) : null}
			</HoverDelegateScope>
		</HoverDelegateScope>
	);
}
