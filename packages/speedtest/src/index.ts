import { SpeedtestApi } from "@repo/shared";
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

let cleanup: (() => void) | undefined;

window.addEventListener(
	"message",
	(event: MessageEvent<{ type: string; data?: string }>) => {
		if (event.data.type === SpeedtestApi.data.method) {
			const json = event.data.data ?? "";
			try {
				const data = JSON.parse(json) as SpeedtestResult;
				renderPage(data, () =>
					postMessage({
						method: SpeedtestApi.viewJson.method,
						params: json,
					}),
				);
			} catch {
				showError("Failed to parse speedtest data.");
			}
		}
	},
);

function renderPage(data: SpeedtestResult, onViewJson: () => void): void {
	const root = document.getElementById("root");
	if (!root) {
		return;
	}

	cleanup?.();
	root.innerHTML = "";

	// Summary
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

	// Chart with tooltip and resize handling
	const container = document.createElement("div");
	container.className = "chart-container";
	const canvas = document.createElement("canvas");
	const tooltip = document.createElement("div");
	tooltip.className = "tooltip";
	container.append(canvas, tooltip);
	root.appendChild(container);

	const chartData = {
		labels: data.intervals.map((iv) => `${iv.end_time_seconds.toFixed(0)}s`),
		values: data.intervals.map((iv) => iv.throughput_mbits),
		pointLabels: data.intervals.map(
			(iv) =>
				`${iv.throughput_mbits.toFixed(2)} Mbps (${iv.start_time_seconds.toFixed(0)}\u2013${iv.end_time_seconds.toFixed(0)}s)`,
		),
	};

	let points: ChartPoint[] = [];
	const draw = () => {
		points = renderLineChart(canvas, chartData);
	};
	draw();

	const observer = new ResizeObserver(draw);
	observer.observe(container);

	const onMouseMove = (e: MouseEvent) => {
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		const hit = points.find(
			(p) => Math.abs(p.x - mx) < 12 && Math.abs(p.y - my) < 12,
		);
		if (hit) {
			tooltip.textContent = hit.label;
			tooltip.style.left = `${hit.x}px`;
			tooltip.style.top = `${hit.y - 32}px`;
			tooltip.classList.add("visible");
		} else {
			tooltip.classList.remove("visible");
		}
	};
	const onMouseLeave = () => tooltip.classList.remove("visible");
	canvas.addEventListener("mousemove", onMouseMove);
	canvas.addEventListener("mouseleave", onMouseLeave);

	cleanup = () => {
		observer.disconnect();
		canvas.removeEventListener("mousemove", onMouseMove);
		canvas.removeEventListener("mouseleave", onMouseLeave);
	};

	// Actions
	const actions = document.createElement("div");
	actions.className = "actions";
	const viewBtn = document.createElement("button");
	viewBtn.textContent = "View JSON";
	viewBtn.addEventListener("click", onViewJson);
	actions.appendChild(viewBtn);
	root.appendChild(actions);
}

function showError(message: string): void {
	const root = document.getElementById("root");
	if (root) {
		root.innerHTML = `<p class="error">${message}</p>`;
	}
}
