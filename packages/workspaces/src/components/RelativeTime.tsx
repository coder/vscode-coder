import { Tooltip } from "@repo/ui";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useEffect, useState } from "react";

import "./RelativeTime.css";

dayjs.extend(relativeTime);

/** Keeps a timestamp's age current without re-rendering the workspace tree. */
export function RelativeTime({ timestamp }: { timestamp: number }) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1_000);
		return () => clearInterval(timer);
	}, []);

	const date = new Date(timestamp);
	// A pushed timestamp can be newer than the most recent clock tick.
	const relativeNow = Math.max(now, timestamp);
	return (
		<Tooltip
			content={date.toLocaleString(undefined, {
				year: "numeric",
				month: "long",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
				second: "2-digit",
				timeZoneName: "short",
			})}
		>
			<time
				className="workspace-relative-time"
				dateTime={date.toISOString()}
				aria-live="off"
				tabIndex={0}
			>
				{dayjs(timestamp).from(dayjs(relativeNow))}
			</time>
		</Tooltip>
	);
}
