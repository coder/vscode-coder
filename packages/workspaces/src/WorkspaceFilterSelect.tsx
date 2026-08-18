import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
	Icon,
} from "@repo/ui";

/** Which workspace set the panel lists. */
export type WorkspaceFilter = "mine" | "all" | "shared";

const FILTER_LABELS: Record<WorkspaceFilter, string> = {
	mine: "Mine",
	all: "All",
	shared: "Shared",
};

export interface WorkspaceFilterSelectProps {
	/** "Shared" is hidden unless the signed-in user is an owner. */
	isOwner?: boolean;
	value: WorkspaceFilter;
	onChange: (filter: WorkspaceFilter) => void;
}

export function WorkspaceFilterSelect({
	isOwner = false,
	value,
	onChange,
}: WorkspaceFilterSelectProps): React.JSX.Element {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="secondary" className="workspaces-panel__filter">
					{FILTER_LABELS[value]}
					<Icon name="chevron-down" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				<DropdownMenuRadioGroup
					value={value}
					onValueChange={(filter) => onChange(filter as WorkspaceFilter)}
				>
					<DropdownMenuRadioItem value="mine">
						{FILTER_LABELS.mine}
					</DropdownMenuRadioItem>
					<DropdownMenuRadioItem value="all">
						{FILTER_LABELS.all}
					</DropdownMenuRadioItem>
					{isOwner ? (
						<DropdownMenuRadioItem value="shared">
							{FILTER_LABELS.shared}
						</DropdownMenuRadioItem>
					) : null}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
