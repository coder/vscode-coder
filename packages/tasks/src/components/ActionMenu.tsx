// VscodeContextMenu is data-driven with { label, value, separator }[] and lacks
// support for icons, per-item danger styling, loading spinners, and disabled
// states. We keep a custom implementation.
import {
	VscodeIcon,
	VscodeProgressRing,
} from "@vscode-elements/react-elements";
import { useState, useRef, useEffect } from "react";

interface ActionMenuAction {
	separator?: false;
	label: string;
	icon?: string;
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

	const isOpen = position !== null;

	function open() {
		if (buttonRef.current) {
			const rect = buttonRef.current.getBoundingClientRect();
			setPosition({
				top: rect.bottom + 4,
				right: window.innerWidth - rect.right,
			});
		}
	}

	function close() {
		setPosition(null);
	}

	useEffect(() => {
		if (!isOpen) return undefined;

		function handleClickOutside(event: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				close();
			}
		}

		function handleScroll() {
			close();
		}

		document.addEventListener("mousedown", handleClickOutside);
		window.addEventListener("scroll", handleScroll, true);

		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
			window.removeEventListener("scroll", handleScroll, true);
		};
	}, [isOpen]);

	return (
		<div className="action-menu" ref={menuRef}>
			<div ref={buttonRef}>
				<VscodeIcon
					actionIcon
					name="ellipsis"
					label="More actions"
					onClick={() => (isOpen ? close() : open())}
				/>
			</div>
			{position && (
				<div
					className="action-menu-dropdown"
					style={{ top: position.top, right: position.right }}
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
								className={`action-menu-item ${item.danger ? "danger" : ""} ${item.loading ? "loading" : ""}`}
								onClick={() => {
									if (!item.loading) {
										item.onClick();
										close();
									}
								}}
								disabled={item.disabled ?? item.loading}
							>
								{item.loading ? (
									<VscodeProgressRing className="action-menu-spinner" />
								) : item.icon ? (
									<VscodeIcon name={item.icon} className="action-menu-icon" />
								) : null}
								<span>{item.label}</span>
							</button>
						),
					)}
				</div>
			)}
		</div>
	);
}
