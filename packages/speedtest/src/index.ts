import { SpeedtestApi, type SpeedtestResult, toError } from "@repo/shared";
import { postMessage, subscribeNotification } from "@repo/webview-shared";

import { renderLineChart } from "./chart";
import {
	type ChartPoint,
	findNearestDot,
	findNearestOnLine,
	toChartSamples,
} from "./chartUtils";
import "./index.css";

/** Above this sample count, render the line alone (no per-point dots). */
const DOT_THRESHOLD = 20;
/** Gap in pixels between the tooltip and the point it describes. */
const TOOLTIP_GAP_PX = 32;

let cleanup: (() => void) | undefined;

function main(): void {
	subscribeNotification(SpeedtestApi.data, ({ workspaceName, result }) => {
		try {
			cleanup?.();
			cleanup = renderPage(result, workspaceName, () =>
				postMessage({ method: SpeedtestApi.viewJson.method }),
			);
		} catch (err) {
			showError(`Failed to render speedtest: ${toError(err).message}`);
		}
	});
}

function renderPage(
	data: SpeedtestResult,
	workspaceName: string,
	onViewJson: () => void,
): () => void {
	const root = document.getElementById("root");
	if (!root) {
		return () => undefined;
	}

	root.innerHTML = "";
	root.appendChild(renderHeading(workspaceName));
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

function renderHeading(workspaceName: string): HTMLElement {
	const heading = document.createElement("h1");
	heading.className = "workspace-name";
	heading.textContent = workspaceName;
	return heading;
}

function renderSummary(data: SpeedtestResult): HTMLElement {
	const summary = document.createElement("div");
	summary.className = "summary";
	summary.innerHTML = `
		<div class="stat">
			<span class="stat-label">Throughput</span>
			<span class="stat-value">${data.overall.throughput_mbits.toFixed(2)} <small>Mbps</small></span>
		</div>
		<div class="stat">
			<span class="stat-label">Duration</span>
			<span class="stat-value">${data.overall.end_time_seconds.toFixed(1)}<small>s</small></span>
		</div>
		<div class="stat">
			<span class="stat-label">Intervals</span>
			<span class="stat-value">${data.intervals.length}</span>
		</div>
	`;
	return summary;
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
	let canvasRect: DOMRect | undefined;
	const draw = () => {
		points = renderLineChart(canvas, samples, showDots);
		canvasRect = canvas.getBoundingClientRect();
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
		if (!canvasRect) {
			return;
		}
		const mx = e.clientX - canvasRect.left;
		const my = e.clientY - canvasRect.top;
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
		tooltip.style.top = `${hit.y - TOOLTIP_GAP_PX}px`;
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
