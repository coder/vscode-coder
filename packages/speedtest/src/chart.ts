import { type ChartPoint, formatTick, niceRound, niceStep } from "./chartUtils";

const MIN_TICK_SPACING_EM = 4;
/** Target Y-axis tick intervals; the actual count varies slightly so steps land on round numbers. */
const Y_TICK_TARGET = 6;
/** 10% headroom above the max so the line doesn't hug the top edge. */
const Y_HEADROOM = 1.1;
const DOT_RADIUS_PX = 4;
const LINE_WIDTH_PX = 2;

const PLOT_PAD_EM = { top: 2, right: 2, bottom: 3.5 };
const Y_LABEL_GAP_EM = 1;
const X_LABEL_GAP_EM = 1.5;
const X_AXIS_TITLE_GAP_EM = 0.25;
const Y_AXIS_TITLE_GAP_EM = 1;
/** Room reserved for the rotated "Mbps" title. */
const Y_AXIS_TITLE_ROOM_EM = 1.5;
const LEFT_PAD_EM = Y_AXIS_TITLE_GAP_EM + Y_AXIS_TITLE_ROOM_EM + Y_LABEL_GAP_EM;

interface Theme {
	fg: string;
	accent: string;
	grid: string;
	family: string;
}

interface YAxis {
	step: number;
	ticks: number;
	max: number;
	format: (v: number) => string;
}

interface Chart {
	ctx: CanvasRenderingContext2D;
	theme: Theme;
	pxPerEm: number;
	pad: { top: number; right: number; bottom: number; left: number };
	plotW: number;
	plotH: number;
	baseline: number;
	height: number;
	maxX: number;
	toCanvasX: (t: number) => number;
	toCanvasY: (v: number) => number;
}

/** Render the speedtest chart. Caller must ensure `samples` is non-empty. */
export function renderLineChart(
	canvas: HTMLCanvasElement,
	samples: ChartPoint[],
	showDots: boolean,
): ChartPoint[] {
	// Scale backing store by DPR so drawing stays crisp on high-DPI screens.
	const parent = canvas.parentElement ?? canvas;
	const { width, height } = parent.getBoundingClientRect();
	const dpr = window.devicePixelRatio || 1;
	canvas.width = width * dpr;
	canvas.height = height * dpr;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return [];
	}
	ctx.scale(dpr, dpr);

	const pxPerEm = parseFloat(getComputedStyle(parent).fontSize) || 14;
	const theme = readTheme();
	const yAxis = computeYAxis(samples);
	const last = samples.at(-1) ?? samples[0];
	const maxX = Math.max(last.x, 1);

	ctx.font = `1em ${theme.family}`;
	const yLabelWidth = ctx.measureText(yAxis.format(yAxis.max)).width;
	const pad = {
		top: PLOT_PAD_EM.top * pxPerEm,
		right: PLOT_PAD_EM.right * pxPerEm,
		bottom: PLOT_PAD_EM.bottom * pxPerEm,
		left: Math.max(
			PLOT_PAD_EM.right * pxPerEm,
			yLabelWidth + LEFT_PAD_EM * pxPerEm,
		),
	};
	const plotW = width - pad.left - pad.right;
	const plotH = height - pad.top - pad.bottom;

	const chart: Chart = {
		ctx,
		theme,
		pxPerEm,
		pad,
		plotW,
		plotH,
		baseline: pad.top + plotH,
		height,
		maxX,
		toCanvasX: (t) => pad.left + (t / maxX) * plotW,
		toCanvasY: (v) => pad.top + plotH - (v / yAxis.max) * plotH,
	};

	drawYAxis(chart, yAxis);
	drawXAxis(chart);
	drawAxisTitles(chart);
	return drawSeries(chart, samples, last, showDots);
}

function computeYAxis(samples: ChartPoint[]): YAxis {
	let peak = 1;
	for (const s of samples) {
		if (s.y > peak) peak = s.y;
	}
	const target = peak * Y_HEADROOM;
	const step = niceRound(target / Y_TICK_TARGET);
	const ticks = Math.ceil(target / step);
	const max = ticks * step;
	// Decimals follow the step's magnitude: step=1 → 0 decimals, step=0.1 → 1, etc.
	const decimals = Math.max(0, -Math.floor(Math.log10(step)));
	return { step, ticks, max, format: (v) => v.toFixed(decimals) };
}

function drawYAxis(chart: Chart, axis: YAxis): void {
	const { ctx, theme, pad, plotW, pxPerEm, toCanvasY } = chart;
	ctx.strokeStyle = theme.grid;
	ctx.lineWidth = 1;
	ctx.fillStyle = theme.fg;
	ctx.textAlign = "right";
	for (let i = 0; i <= axis.ticks; i++) {
		const v = i * axis.step;
		const y = toCanvasY(v);
		ctx.beginPath();
		ctx.moveTo(pad.left, y);
		ctx.lineTo(pad.left + plotW, y);
		ctx.stroke();
		ctx.fillText(
			axis.format(v),
			pad.left - Y_LABEL_GAP_EM * pxPerEm,
			y + pxPerEm / 3,
		);
	}
}

function drawXAxis(chart: Chart): void {
	const { ctx, theme, pad, plotW, baseline, height, pxPerEm, maxX, toCanvasX } =
		chart;
	ctx.strokeStyle = theme.fg;
	ctx.beginPath();
	ctx.moveTo(pad.left, baseline);
	ctx.lineTo(pad.left + plotW, baseline);
	ctx.stroke();

	ctx.textAlign = "center";
	const step = niceStep(
		maxX / Math.max(1, Math.floor(plotW / (MIN_TICK_SPACING_EM * pxPerEm))),
	);
	for (let t = 0; t <= maxX; t += step) {
		ctx.fillText(
			formatTick(t, step),
			toCanvasX(t),
			height - pad.bottom + X_LABEL_GAP_EM * pxPerEm,
		);
	}
}

function drawAxisTitles(chart: Chart): void {
	const { ctx, theme, pad, plotW, plotH, height, pxPerEm } = chart;
	ctx.font = `0.95em ${theme.family}`;
	ctx.fillText(
		"Time",
		pad.left + plotW / 2,
		height - X_AXIS_TITLE_GAP_EM * pxPerEm,
	);
	ctx.save();
	ctx.translate(Y_AXIS_TITLE_GAP_EM * pxPerEm, pad.top + plotH / 2);
	ctx.rotate(-Math.PI / 2);
	ctx.fillText("Mbps", 0, 0);
	ctx.restore();
}

function drawSeries(
	chart: Chart,
	samples: ChartPoint[],
	last: ChartPoint,
	showDots: boolean,
): ChartPoint[] {
	const { ctx, theme, pad, baseline, toCanvasX, toCanvasY } = chart;
	const first = samples[0];

	if (first.x > 0) {
		ctx.beginPath();
		ctx.moveTo(toCanvasX(0), baseline);
		ctx.lineTo(toCanvasX(first.x), toCanvasY(first.y));
		ctx.setLineDash([4, 4]);
		ctx.strokeStyle = theme.accent;
		ctx.lineWidth = 1;
		ctx.globalAlpha = 0.4;
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.globalAlpha = 1;
	}

	ctx.beginPath();
	ctx.moveTo(toCanvasX(first.x), baseline);
	for (const s of samples) {
		ctx.lineTo(toCanvasX(s.x), toCanvasY(s.y));
	}
	ctx.lineTo(toCanvasX(last.x), baseline);
	ctx.closePath();
	const grad = ctx.createLinearGradient(0, pad.top, 0, baseline);
	grad.addColorStop(0, withAlpha(theme.accent, "18"));
	grad.addColorStop(1, withAlpha(theme.accent, "04"));
	ctx.fillStyle = grad;
	ctx.fill();

	ctx.beginPath();
	ctx.moveTo(toCanvasX(first.x), toCanvasY(first.y));
	for (let i = 1; i < samples.length; i++) {
		ctx.lineTo(toCanvasX(samples[i].x), toCanvasY(samples[i].y));
	}
	ctx.strokeStyle = theme.accent;
	ctx.lineWidth = LINE_WIDTH_PX;
	ctx.stroke();

	return samples.map((s) => {
		const x = toCanvasX(s.x);
		const y = toCanvasY(s.y);
		if (showDots) {
			ctx.beginPath();
			ctx.arc(x, y, DOT_RADIUS_PX, 0, Math.PI * 2);
			ctx.fillStyle = theme.accent;
			ctx.fill();
		}
		return { x, y, label: s.label };
	});
}

/** Canvas pixels don't inherit CSS vars, so re-read on every render. */
function readTheme(): Theme {
	const s = getComputedStyle(document.documentElement);
	const css = (prop: string) => s.getPropertyValue(prop).trim();
	return {
		fg:
			css("--vscode-charts-foreground") ||
			css("--vscode-descriptionForeground") ||
			css("--vscode-editor-foreground") ||
			"#888",
		// focusBorder tracks the theme's accent; charts.blue is a fixed hue
		// kept as a late fallback.
		accent:
			css("--vscode-chart-line") ||
			css("--vscode-focusBorder") ||
			css("--vscode-charts-blue") ||
			"#3794ff",
		grid:
			css("--vscode-chart-guide") ||
			css("--vscode-charts-lines") ||
			"rgba(127, 127, 127, 0.35)",
		family: css("--vscode-font-family") || "sans-serif",
	};
}

/** Append an `aa` alpha byte to a CSS color, using a dedicated canvas to
 *  normalize any input (rgb/hsl/hex/named) to `#rrggbb`. */
let normalizerCtx: CanvasRenderingContext2D | null | undefined;
function withAlpha(color: string, alphaHex: string): string {
	normalizerCtx ??= document.createElement("canvas").getContext("2d");
	if (!normalizerCtx) {
		return color;
	}
	normalizerCtx.fillStyle = color;
	const normalized = String(normalizerCtx.fillStyle);
	return /^#[0-9a-f]{6}$/i.test(normalized)
		? normalized + alphaHex
		: normalized;
}
