import { SpeedtestApi, type SpeedtestResult, toError } from "@repo/shared";
import { postMessage, subscribeNotification } from "@repo/webview-shared";

import { renderLineChart } from "./chart";
import {
	type ChartPoint,
	findNearestDot,
	findNearestOnLine,
	formatDuration,
	formatThroughput,
	toChartSamples,
} from "./chartUtils";
import "./index.css";

/** Above this sample count, render the line alone (no per-point dots). */
const DOT_THRESHOLD = 20;
/** Gap in pixels between the tooltip and the point it describes. */
const TOOLTIP_GAP_PX = 32;

let cleanup: (() => void) | undefined;

function main(): void {
	subscribeNotification(SpeedtestApi.data, ({ workspaceId, result }) => {
		try {
			cleanup?.();
			cleanup = renderPage(result, workspaceId, () =>
				postMessage({ method: SpeedtestApi.viewJson.method }),
			);
		} catch (err) {
			showError(`Failed to render speedtest: ${toError(err).message}`);
		}
	});
	// Signal we're subscribed; the extension waits for this before sending.
	postMessage({ method: SpeedtestApi.ready.method });
}

function renderPage(
	data: SpeedtestResult,
	workspaceId: string,
	onViewJson: () => void,
): () => void {
	const root = document.getElementById("root");
	if (!root) {
		return () => undefined;
	}

	root.innerHTML = "";
	root.appendChild(renderHeading(workspaceId));
	root.appendChild(renderSummary(data));

	const samples = toChartSamples(data.intervals);
	if (samples.length === 0) {
		root.appendChild(renderEmptyMessage());
		root.appendChild(renderActions(onViewJson));
		return () => undefined;
	}

	const chart = renderChart(samples);
	root.appendChild(chart.container);
	root.appendChild(renderActions(onViewJson));
	return chart.cleanup;
}

function renderHeading(workspaceId: string): HTMLElement {
	const header = document.createElement("header");
	header.className = "page-header";

	const eyebrow = document.createElement("p");
	eyebrow.className = "eyebrow";
	eyebrow.textContent = "Speed Test";

	const heading = document.createElement("h1");
	heading.className = "workspace-id";
	heading.textContent = workspaceId;

	header.append(eyebrow, heading);
	return header;
}

function renderSummary(data: SpeedtestResult): HTMLElement {
	const summary = document.createElement("div");
	summary.className = "summary";
	const duration = formatDuration(data.overall.end_time_seconds);
	summary.append(
		renderStat("Throughput", formatThroughput(data.overall.throughput_mbits), {
			unit: "Mbps",
		}),
		renderStat("Duration", duration.value, {
			unit: duration.unit,
			tight: true,
		}),
		renderStat("Intervals", String(data.intervals.length)),
	);
	return summary;
}

function renderStat(
	label: string,
	value: string,
	opts?: { unit: string; tight?: boolean },
): HTMLElement {
	const stat = document.createElement("div");
	stat.className = "stat";

	const labelEl = document.createElement("span");
	labelEl.className = "stat-label";
	labelEl.textContent = label;

	const valueEl = document.createElement("span");
	valueEl.className = "stat-value";
	if (opts) {
		valueEl.textContent = opts.tight ? value : `${value} `;
		const unitEl = document.createElement("small");
		unitEl.textContent = opts.unit;
		valueEl.appendChild(unitEl);
	} else {
		valueEl.textContent = value;
	}

	stat.append(labelEl, valueEl);
	return stat;
}

function renderChart(samples: ChartPoint[]): {
	container: HTMLElement;
	cleanup: () => void;
} {
	const container = document.createElement("div");
	container.className = "chart-container";
	const canvas = document.createElement("canvas");
	const tooltip = document.createElement("div");
	tooltip.className = "tooltip";
	container.append(canvas, tooltip);

	const showDots = samples.length <= DOT_THRESHOLD;
	let points: ChartPoint[] = [];
	const draw = () => {
		try {
			points = renderLineChart(canvas, samples, showDots);
		} catch (err) {
			showError(`Failed to render speedtest: ${toError(err).message}`);
		}
	};

	// ResizeObserver's first callback (fired when the caller appends `container`
	// to the DOM) drives the initial paint; later fires handle resizes.
	let rafId = 0;
	const observer = new ResizeObserver(() => {
		cancelAnimationFrame(rafId);
		rafId = requestAnimationFrame(draw);
	});
	observer.observe(container);

	const onMouseMove = (e: MouseEvent) => {
		// Re-read on each move so scroll/layout shifts don't desync the hit test.
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		const hit = showDots
			? findNearestDot(points, mx, my)
			: findNearestOnLine(points, mx);
		if (!hit) {
			tooltip.classList.remove("visible");
			return;
		}
		tooltip.textContent = hit.label;
		const tw = tooltip.offsetWidth;
		const left = Math.max(
			0,
			Math.min(hit.x - tw / 2, container.offsetWidth - tw),
		);
		tooltip.style.left = `${left}px`;
		tooltip.style.top = `${Math.max(0, hit.y - TOOLTIP_GAP_PX)}px`;
		tooltip.classList.add("visible");
	};
	const onMouseLeave = () => tooltip.classList.remove("visible");
	canvas.addEventListener("mousemove", onMouseMove);
	canvas.addEventListener("mouseleave", onMouseLeave);

	return {
		container,
		cleanup: () => {
			cancelAnimationFrame(rafId);
			observer.disconnect();
			canvas.removeEventListener("mousemove", onMouseMove);
			canvas.removeEventListener("mouseleave", onMouseLeave);
		},
	};
}

function renderActions(onViewJson: () => void): HTMLElement {
	const actions = document.createElement("div");
	actions.className = "actions";
	const viewBtn = document.createElement("button");
	viewBtn.textContent = "View JSON";
	viewBtn.addEventListener("click", onViewJson);
	actions.appendChild(viewBtn);
	return actions;
}

function renderEmptyMessage(): HTMLElement {
	const p = document.createElement("p");
	p.className = "empty";
	p.textContent = "No samples returned from the speed test.";
	return p;
}

function showError(message: string): void {
	const root = document.getElementById("root");
	if (!root) {
		return;
	}
	const p = document.createElement("p");
	p.className = "error";
	p.textContent = message;
	root.replaceChildren(p);
}

main();
