import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
	Icon,
	MenuRadioGroup,
	MenuRadioItem,
} from "@repo/ui";

import "./FilterBar.css";
import { RelativeTime } from "./RelativeTime";

import type { WorkspaceFilter } from "@repo/shared";

const FILTERS = [
	{ value: "all", label: "All" },
	{ value: "mine", label: "Mine" },
	{ value: "shared", label: "Shared" },
] as const satisfies ReadonlyArray<{ value: WorkspaceFilter; label: string }>;

export function FilterBar({
	filter,
	filters,
	listedAtMs,
	onFilterChange,
}: {
	filter: WorkspaceFilter;
	filters: readonly WorkspaceFilter[];
	listedAtMs: number | null;
	onFilterChange: (filter: WorkspaceFilter) => void;
}) {
	const label = FILTERS.find(({ value }) => value === filter)?.label;
	return (
		<div className="workspaces-filter-bar">
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="secondary"
							className="workspaces-filter"
							aria-label={`Workspace filter: ${label}`}
						>
							{label}
							<Icon name="chevron-down" />
						</Button>
					}
				/>
				<DropdownMenuContent>
					<MenuRadioGroup
						value={filter}
						onValueChange={(value) => {
							const choice = FILTERS.find((option) => option.value === value);
							if (choice) onFilterChange(choice.value);
						}}
					>
						{FILTERS.map(({ value, label }) => (
							<MenuRadioItem
								key={value}
								value={value}
								disabled={!filters.includes(value)}
							>
								{label}
							</MenuRadioItem>
						))}
					</MenuRadioGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			{listedAtMs !== null && (
				<>
					<span
						className="workspaces-filter-bar__separator"
						aria-hidden="true"
					/>
					<span className="workspaces-filter-bar__updated">
						Updated <RelativeTime timestamp={listedAtMs} />
					</span>
				</>
			)}
		</div>
	);
}
