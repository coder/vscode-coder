import {
	VscodeIcon,
	VscodeProgressRing,
} from "@vscode-elements/react-elements";
import { useState, useRef, useEffect, useCallback } from "react";

export interface ActionMenuItem {
	label: string;
	icon?: string;
	onClick: () => void;
	disabled?: boolean;
	danger?: boolean;
	loading?: boolean;
}

interface ActionMenuProps {
	items: ActionMenuItem[];
}

export function ActionMenu({ items }: ActionMenuProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [position, setPosition] = useState({ top: 0, left: 0 });
	const menuRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLDivElement>(null);

	const updatePosition = useCallback(() => {
		if (buttonRef.current) {
			const rect = buttonRef.current.getBoundingClientRect();
			setPosition({
				top: rect.bottom + 4,
				left: rect.right - 150, // Align right edge of menu with button
			});
		}
	}, []);

	useEffect(() => {
		if (!isOpen) return undefined;

		function handleClickOutside(event: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		}

		function handleScroll() {
			setIsOpen(false);
		}

		document.addEventListener("mousedown", handleClickOutside);
		window.addEventListener("scroll", handleScroll, true);
		updatePosition();

		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
			window.removeEventListener("scroll", handleScroll, true);
		};
	}, [isOpen, updatePosition]);

	const handleToggle = () => {
		if (!isOpen) {
			updatePosition();
		}
		setIsOpen(!isOpen);
	};

	return (
		<div className="action-menu" ref={menuRef}>
			<div ref={buttonRef}>
				<VscodeIcon
					actionIcon
					name="ellipsis"
					label="More actions"
					onClick={handleToggle}
				/>
			</div>
			{isOpen && (
				<div
					className="action-menu-dropdown"
					style={{ top: position.top, left: Math.max(0, position.left) }}
				>
					{items.map((item, index) => (
						<button
							key={`${item.label}-${index}`}
							type="button"
							className={`action-menu-item ${item.danger ? "danger" : ""} ${item.loading ? "loading" : ""}`}
							onClick={() => {
								if (!item.loading) {
									item.onClick();
									setIsOpen(false);
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
					))}
				</div>
			)}
		</div>
	);
}
