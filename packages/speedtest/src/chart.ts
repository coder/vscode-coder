export interface ChartPoint {
	x: number;
	y: number;
	label: string;
}

export interface ChartData {
	xValues: number[];
	values: number[];
	pointLabels: string[];
}

/** Points above this count are drawn as a line only (no dots). */
export const DOT_THRESHOLD = 20;

const DOT_RADIUS = 4;
const MIN_TICK_SPACING = 48;
const LEADER_OPACITY = 0.4;
const Y_GRID_LINES = 5;
const Y_HEADROOM = 1.1;

const NICE_STEPS = [
	1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600, 900, 1800, 3600,
];

function niceStep(raw: number): number {
	return NICE_STEPS.find((s) => s >= raw) ?? Math.ceil(raw / 3600) * 3600;
}

const TICK_UNITS: Array<[number, string]> = [
	[3600, "h"],
	[60, "m"],
	[1, "s"],
];

function tickFormatter(step: number): (t: number) => string {
	const [divisor, suffix] = TICK_UNITS.find(([d]) => step >= d) ?? [1, "s"];
	return (t) => {
		const v = t / divisor;
		return `${Number.isInteger(v) ? v : v.toFixed(1)}${suffix}`;
	};
}

export function renderLineChart(
	canvas: HTMLCanvasElement,
	data: ChartData,
): ChartPoint[] {
	const dpr = window.devicePixelRatio || 1;
	const container = canvas.parentElement;
	const { width, height } = container
		? container.getBoundingClientRect()
		: canvas.getBoundingClientRect();
	canvas.width = width * dpr;
	canvas.height = height * dpr;

	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return [];
	}
	ctx.scale(dpr, dpr);

	const n = data.values.length;
	const maxVal = Math.max(...data.values, 1) * Y_HEADROOM;
	const maxX = n > 0 ? data.xValues[n - 1] : 1;
	const xRange = maxX || 1;

	const s = getComputedStyle(document.documentElement);
	const css = (prop: string) => s.getPropertyValue(prop).trim();
	const fg =
		css("--vscode-descriptionForeground") ||
		css("--vscode-editor-foreground") ||
		"#888";
	const accent =
		css("--vscode-charts-blue") ||
		css("--vscode-terminal-ansiBlue") ||
		"#3794ff";
	const grid = css("--vscode-editorWidget-border") || "rgba(128,128,128,0.15)";
	const family = css("--vscode-font-family") || "sans-serif";

	ctx.font = `1em ${family}`;
	const yLabelWidth = ctx.measureText(maxVal.toFixed(0)).width;
	const pad = {
		top: 24,
		right: 24,
		bottom: 52,
		left: Math.max(48, yLabelWidth + 24),
	};
	const plotW = width - pad.left - pad.right;
	const plotH = height - pad.top - pad.bottom;

	const tAt = (t: number) => pad.left + (t / xRange) * plotW;
	const xAt = (i: number) => tAt(data.xValues[i]);
	const yAt = (v: number) => pad.top + plotH - (v / maxVal) * plotH;

	ctx.strokeStyle = grid;
	ctx.lineWidth = 1;
	ctx.fillStyle = fg;
	ctx.textAlign = "right";
	for (let i = 0; i <= Y_GRID_LINES; i++) {
		const y = yAt((i / Y_GRID_LINES) * maxVal);
		ctx.beginPath();
		ctx.moveTo(pad.left, y);
		ctx.lineTo(pad.left + plotW, y);
		ctx.stroke();
		ctx.fillText(
			((i / Y_GRID_LINES) * maxVal).toFixed(0),
			pad.left - 12,
			y + 5,
		);
	}

	ctx.strokeStyle = fg;
	ctx.beginPath();
	ctx.moveTo(pad.left, pad.top + plotH);
	ctx.lineTo(pad.left + plotW, pad.top + plotH);
	ctx.stroke();

	ctx.textAlign = "center";
	ctx.fillStyle = fg;
	const maxTicks = Math.max(1, Math.floor(plotW / MIN_TICK_SPACING));
	const tickStep = niceStep(xRange / maxTicks);
	const formatTick = tickFormatter(tickStep);
	for (let t = 0; t <= maxX; t += tickStep) {
		ctx.fillText(formatTick(t), tAt(t), height - pad.bottom + 24);
	}

	ctx.font = `0.95em ${family}`;
	ctx.fillText("Time", pad.left + plotW / 2, height - 4);
	ctx.save();
	ctx.translate(14, pad.top + plotH / 2);
	ctx.rotate(-Math.PI / 2);
	ctx.fillText("Mbps", 0, 0);
	ctx.restore();

	if (n === 0) {
		return [];
	}

	const baseline = pad.top + plotH;
	const firstPx = xAt(0);

	if (data.xValues[0] > 0) {
		ctx.beginPath();
		ctx.moveTo(tAt(0), baseline);
		ctx.lineTo(firstPx, yAt(data.values[0]));
		ctx.setLineDash([4, 4]);
		ctx.strokeStyle = accent;
		ctx.lineWidth = 1;
		ctx.globalAlpha = LEADER_OPACITY;
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.globalAlpha = 1;
	}

	ctx.beginPath();
	ctx.moveTo(firstPx, baseline);
	for (let i = 0; i < n; i++) {
		ctx.lineTo(xAt(i), yAt(data.values[i]));
	}
	ctx.lineTo(xAt(n - 1), baseline);
	ctx.closePath();
	const gradient = ctx.createLinearGradient(0, pad.top, 0, baseline);
	gradient.addColorStop(0, accent + "18");
	gradient.addColorStop(1, accent + "04");
	ctx.fillStyle = gradient;
	ctx.fill();

	ctx.beginPath();
	ctx.moveTo(xAt(0), yAt(data.values[0]));
	for (let i = 1; i < n; i++) {
		ctx.lineTo(xAt(i), yAt(data.values[i]));
	}
	ctx.strokeStyle = accent;
	ctx.lineWidth = 2;
	ctx.stroke();

	const showDots = n <= DOT_THRESHOLD;
	const points: ChartPoint[] = [];
	for (let i = 0; i < n; i++) {
		const x = xAt(i);
		const y = yAt(data.values[i]);
		if (showDots) {
			ctx.beginPath();
			ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
			ctx.fillStyle = accent;
			ctx.fill();
		}
		points.push({ x, y, label: data.pointLabels[i] });
	}
	return points;
}
