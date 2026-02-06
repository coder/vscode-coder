// VscodeContextMenu is data-driven with { label, value, separator }[] and lacks
// support for icons, per-item danger styling, loading spinners, and disabled states.
import {
	VscodeIcon,
	VscodeProgressRing,
} from "@vscode-elements/react-elements";
import { useState, useRef, useEffect, useCallback } from "react";

interface ActionMenuAction {
	separator?: false;
	label: string;
	icon: string;
	onClick: () => void;
	disabled?: boolean;
	danger?: boolean;
	loading?: boolean;
}

interface ActionMenuSeparator {
	separator: true;
}

export type ActionMenuItem = ActionMenuAction | ActionMenuSeparator;

interface ActionMenuProps {
	items: ActionMenuItem[];
}

export function ActionMenu({ items }: ActionMenuProps) {
	const [position, setPosition] = useState<{
		top: number;
		right: number;
	} | null>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLDivElement>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);

	function toggle() {
		setPosition((prev) => {
			if (prev) {
				return null;
			}
			const rect = buttonRef.current?.getBoundingClientRect();
			if (!rect) {
				return null;
			}
			return { top: rect.bottom, right: window.innerWidth - rect.right };
		});
	}

	const isOpen = position !== null;

	const dropdownRefCallback = useCallback((node: HTMLDivElement | null) => {
		dropdownRef.current = node;
		node?.focus();
	}, []);

	function onKeyDown(event: React.KeyboardEvent) {
		if (event.key === "Escape") {
			setPosition(null);
		}
	}

	useEffect(() => {
		if (!isOpen) return;

		const close = () => setPosition(null);

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
			<div ref={buttonRef}>
				<VscodeIcon
					actionIcon
					name="ellipsis"
					label="More actions"
					onClick={toggle}
				/>
			</div>
			{position && (
				<div
					ref={dropdownRefCallback}
					className="action-menu-dropdown"
					style={position}
					tabIndex={-1}
					onKeyDown={onKeyDown}
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
									setPosition(null);
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
