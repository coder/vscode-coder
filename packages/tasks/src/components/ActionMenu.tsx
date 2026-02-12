import {
	VscodeIcon,
	VscodeProgressRing,
} from "@vscode-elements/react-elements";
import { useState, useRef, useEffect } from "react";

import { isEscape } from "../utils/keys";

interface ActionMenuAction {
	label: string;
	icon: string;
	onClick: () => void;
	disabled?: boolean;
	danger?: boolean;
	loading?: boolean;
}

export type ActionMenuItem =
	| { separator: true }
	| ({ separator?: false } & ActionMenuAction);

interface ActionMenuProps {
	items: ActionMenuItem[];
}

/*
 * VscodeContextMenu is data-driven with { label, value, separator }[] and lacks
 * support for icons, per-item danger styling, loading spinners, and disabled states.
 */
export function ActionMenu({ items }: ActionMenuProps) {
	const [isOpen, setIsOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	const close = () => setIsOpen(false);

	useEffect(() => {
		if (!isOpen) return;

		function onMouseDown(event: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				close();
			}
		}

		document.addEventListener("mousedown", onMouseDown);
		window.addEventListener("scroll", close, true);

		return () => {
			document.removeEventListener("mousedown", onMouseDown);
			window.removeEventListener("scroll", close, true);
		};
	}, [isOpen]);

	return (
		<div className="action-menu" ref={menuRef}>
			<VscodeIcon
				actionIcon
				name="ellipsis"
				label="More actions"
				onClick={() => setIsOpen((prev) => !prev)}
			/>
			{isOpen && (
				<div
					ref={(node) => {
						if (!node || !menuRef.current) {
							return;
						}
						const rect = menuRef.current.getBoundingClientRect();
						node.style.top = `${rect.bottom + 4}px`;
						node.style.right = `${window.innerWidth - rect.right}px`;
						node.focus({ preventScroll: true });
					}}
					className="action-menu-dropdown"
					tabIndex={-1}
					onKeyDown={(e) => isEscape(e) && close()}
				>
					{items.map((item, index) =>
						item.separator ? (
							<div
								key={`sep-${index}`}
								className="action-menu-separator"
								role="separator"
							/>
						) : (
							<button
								key={`${item.label}-${index}`}
								type="button"
								className={[
									"action-menu-item",
									item.danger && "danger",
									item.loading && "loading",
								]
									.filter(Boolean)
									.join(" ")}
								onClick={() => {
									item.onClick();
									close();
								}}
								disabled={item.disabled === true || item.loading === true}
							>
								{item.loading ? (
									<VscodeProgressRing className="action-menu-spinner" />
								) : (
									<VscodeIcon name={item.icon} className="action-menu-icon" />
								)}
								<span>{item.label}</span>
							</button>
						),
					)}
				</div>
			)}
		</div>
	);
}
