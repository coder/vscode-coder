import { type SpeedtestData, SpeedtestApi } from "@repo/shared";
import { postMessage } from "@repo/webview-shared";

import { type ChartPoint, renderLineChart } from "./chart";
import "./index.css";

interface SpeedtestInterval {
	start_time_seconds: number;
	end_time_seconds: number;
	throughput_mbits: number;
}

interface SpeedtestResult {
	overall: SpeedtestInterval;
	intervals: SpeedtestInterval[];
}

const HIT_RADIUS_PX = 12;
/** Above this sample count, render the line alone (no per-point dots). */
const DOT_THRESHOLD = 20;

let cleanup: (() => void) | undefined;

window.addEventListener(
	"message",
	(event: MessageEvent<{ type: string; data?: SpeedtestData }>) => {
		if (event.data.type !== SpeedtestApi.data.method || !event.data.data) {
			return;
		}
		const { json, workspaceName } = event.data.data;
		try {
			const result = JSON.parse(json) as SpeedtestResult;
			cleanup?.();
			cleanup = renderPage(result, workspaceName, () =>
				postMessage({
					method: SpeedtestApi.viewJson.method,
					params: json,
				}),
			);
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			showError(`Failed to parse speedtest data: ${detail}`);
		}
	},
);

function toChartSamples(intervals: SpeedtestInterval[]): ChartPoint[] {
	return intervals.map((iv) => ({
		x: iv.end_time_seconds,
		y: iv.throughput_mbits,
		label: `${iv.throughput_mbits.toFixed(2)} Mbps (${iv.start_time_seconds.toFixed(0)}\u2013${iv.end_time_seconds.toFixed(0)}s)`,
	}));
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

	const heading = document.createElement("h1");
	heading.className = "workspace-name";
	heading.textContent = workspaceName;
	root.appendChild(heading);

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
	root.appendChild(summary);

	const container = document.createElement("div");
	container.className = "chart-container";
	const canvas = document.createElement("canvas");
	const tooltip = document.createElement("div");
	tooltip.className = "tooltip";
	container.append(canvas, tooltip);
	root.appendChild(container);

	const samples = toChartSamples(data.intervals);
	const showDots = samples.length <= DOT_THRESHOLD;

	let points: ChartPoint[] = [];
	let canvasRect: DOMRect;
	const draw = () => {
		points = renderLineChart(canvas, samples, showDots);
		canvasRect = canvas.getBoundingClientRect();
	};
	draw();

	let rafId = 0;
	const observer = new ResizeObserver(() => {
		cancelAnimationFrame(rafId);
		rafId = requestAnimationFrame(draw);
	});
	observer.observe(container);

	const onMouseMove = (e: MouseEvent) => {
		const mx = e.clientX - canvasRect.left;
		const my = e.clientY - canvasRect.top;
		const hit = showDots
			? findNearestDot(points, mx, my)
			: findNearestOnLine(points, mx);

		if (hit) {
			tooltip.textContent = hit.label;
			const tw = tooltip.offsetWidth;
			const left = Math.max(
				0,
				Math.min(hit.x - tw / 2, container.offsetWidth - tw),
			);
			tooltip.style.left = `${left}px`;
			tooltip.style.top = `${hit.y - 32}px`;
			tooltip.classList.add("visible");
		} else {
			tooltip.classList.remove("visible");
		}
	};
	const onMouseLeave = () => tooltip.classList.remove("visible");
	canvas.addEventListener("mousemove", onMouseMove);
	canvas.addEventListener("mouseleave", onMouseLeave);

	const actions = document.createElement("div");
	actions.className = "actions";
	const viewBtn = document.createElement("button");
	viewBtn.textContent = "View JSON";
	viewBtn.addEventListener("click", onViewJson);
	actions.appendChild(viewBtn);
	root.appendChild(actions);

	return () => {
		cancelAnimationFrame(rafId);
		observer.disconnect();
		canvas.removeEventListener("mousemove", onMouseMove);
		canvas.removeEventListener("mouseleave", onMouseLeave);
	};
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

function findNearestByX(
	points: ChartPoint[],
	mx: number,
): ChartPoint | undefined {
	if (points.length === 0) {
		return undefined;
	}
	let lo = 0;
	let hi = points.length - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (points[mid].x < mx) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	let best = points[lo];
	if (lo > 0 && Math.abs(points[lo - 1].x - mx) < Math.abs(best.x - mx)) {
		best = points[lo - 1];
	}
	return best;
}

function findNearestDot(
	points: ChartPoint[],
	mx: number,
	my: number,
): ChartPoint | null {
	const best = findNearestByX(points, mx);
	if (!best) {
		return null;
	}
	return Math.abs(best.x - mx) < HIT_RADIUS_PX &&
		Math.abs(best.y - my) < HIT_RADIUS_PX
		? best
		: null;
}

function findNearestOnLine(
	points: ChartPoint[],
	mx: number,
): ChartPoint | null {
	const best = findNearestByX(points, mx);
	if (!best) {
		return null;
	}
	const last = points.at(-1) ?? best;
	const avgGap =
		points.length > 1
			? (last.x - points[0].x) / (points.length - 1)
			: HIT_RADIUS_PX;
	return Math.abs(best.x - mx) < avgGap ? best : null;
}
