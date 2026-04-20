export interface ChartPoint {
	x: number;
	y: number;
	label: string;
}

const MIN_TICK_SPACING_PX = 48;
const Y_GRID_LINES = 5;
/** 10% padding above the max value so the line doesn't hug the top edge. */
const Y_HEADROOM = 1.1;

/** Candidate x-axis tick step sizes in seconds (1s, 2s, 5s, ..., 30m, 1h). */
const TICK_STEP_SECONDS = [
	1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600, 900, 1800, 3600,
];

export function niceStep(raw: number): number {
	return (
		TICK_STEP_SECONDS.find((s) => s >= raw) ?? Math.ceil(raw / 3600) * 3600
	);
}

export function formatTick(t: number, step: number): string {
	if (step >= 3600) {
		const h = t / 3600;
		return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
	}
	if (step >= 60) {
		const m = t / 60;
		return `${Number.isInteger(m) ? m : m.toFixed(1)}m`;
	}
	return `${t}s`;
}

interface Theme {
	fg: string;
	accent: string;
	grid: string;
	family: string;
}

/**
 * Read VS Code theme colors from CSS custom properties on <html>. Canvas
 * pixels don't inherit CSS vars, so we re-read on each render to pick up
 * theme switches.
 */
function readTheme(): Theme {
	const s = getComputedStyle(document.documentElement);
	const css = (prop: string) => s.getPropertyValue(prop).trim();
	return {
		fg:
			css("--vscode-descriptionForeground") ||
			css("--vscode-editor-foreground") ||
			"#888",
		// Use the button color so the accent tracks the theme; charts-* vars
		// are fixed hues by design.
		accent:
			css("--vscode-button-background") ||
			css("--vscode-focusBorder") ||
			css("--vscode-charts-blue") ||
			"#3794ff",
		grid: css("--vscode-editorWidget-border") || "rgba(128,128,128,0.15)",
		family: css("--vscode-font-family") || "sans-serif",
	};
}

function layoutChart(
	ctx: CanvasRenderingContext2D,
	samples: ChartPoint[],
	width: number,
	height: number,
	family: string,
) {
	const maxVal = samples.reduce((m, s) => Math.max(m, s.y), 1) * Y_HEADROOM;
	const maxX = samples.at(-1)?.x ?? 1;
	const xRange = maxX || 1;
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
	return {
		pad,
		plotW,
		plotH,
		maxVal,
		maxX,
		xRange,
		height,
		tAt: (t: number) => pad.left + (t / xRange) * plotW,
		yAt: (v: number) => pad.top + plotH - (v / maxVal) * plotH,
	};
}

type Layout = ReturnType<typeof layoutChart>;

function drawAxes(
	ctx: CanvasRenderingContext2D,
	layout: Layout,
	theme: Theme,
): void {
	const { pad, plotW, plotH, maxVal, maxX, xRange, height, tAt, yAt } = layout;

	ctx.strokeStyle = theme.grid;
	ctx.lineWidth = 1;
	ctx.fillStyle = theme.fg;
	ctx.textAlign = "right";
	for (let i = 0; i <= Y_GRID_LINES; i++) {
		const v = (i / Y_GRID_LINES) * maxVal;
		const y = yAt(v);
		ctx.beginPath();
		ctx.moveTo(pad.left, y);
		ctx.lineTo(pad.left + plotW, y);
		ctx.stroke();
		ctx.fillText(v.toFixed(0), pad.left - 12, y + 5);
	}

	ctx.strokeStyle = theme.fg;
	ctx.beginPath();
	ctx.moveTo(pad.left, pad.top + plotH);
	ctx.lineTo(pad.left + plotW, pad.top + plotH);
	ctx.stroke();

	ctx.textAlign = "center";
	const step = niceStep(
		xRange / Math.max(1, Math.floor(plotW / MIN_TICK_SPACING_PX)),
	);
	for (let t = 0; t <= maxX; t += step) {
		ctx.fillText(formatTick(t, step), tAt(t), height - pad.bottom + 24);
	}

	ctx.font = `0.95em ${theme.family}`;
	ctx.fillText("Time", pad.left + plotW / 2, height - 4);
	ctx.save();
	ctx.translate(14, pad.top + plotH / 2);
	ctx.rotate(-Math.PI / 2);
	ctx.fillText("Mbps", 0, 0);
	ctx.restore();
}

function drawSeries(
	ctx: CanvasRenderingContext2D,
	samples: ChartPoint[],
	layout: Layout,
	theme: Theme,
	showDots: boolean,
): ChartPoint[] {
	const { pad, plotH, tAt, yAt } = layout;
	const baseline = pad.top + plotH;
	const first = samples[0];
	const last = samples.at(-1) ?? first;

	if (first.x > 0) {
		ctx.beginPath();
		ctx.moveTo(tAt(0), baseline);
		ctx.lineTo(tAt(first.x), yAt(first.y));
		ctx.setLineDash([4, 4]);
		ctx.strokeStyle = theme.accent;
		ctx.lineWidth = 1;
		ctx.globalAlpha = 0.4;
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.globalAlpha = 1;
	}

	ctx.beginPath();
	ctx.moveTo(tAt(first.x), baseline);
	for (const s of samples) {
		ctx.lineTo(tAt(s.x), yAt(s.y));
	}
	ctx.lineTo(tAt(last.x), baseline);
	ctx.closePath();
	const grad = ctx.createLinearGradient(0, pad.top, 0, baseline);
	grad.addColorStop(0, theme.accent + "18");
	grad.addColorStop(1, theme.accent + "04");
	ctx.fillStyle = grad;
	ctx.fill();

	ctx.beginPath();
	ctx.moveTo(tAt(first.x), yAt(first.y));
	for (let i = 1; i < samples.length; i++) {
		ctx.lineTo(tAt(samples[i].x), yAt(samples[i].y));
	}
	ctx.strokeStyle = theme.accent;
	ctx.lineWidth = 2;
	ctx.stroke();

	return samples.map((s) => {
		const x = tAt(s.x);
		const y = yAt(s.y);
		if (showDots) {
			ctx.beginPath();
			ctx.arc(x, y, 4, 0, Math.PI * 2);
			ctx.fillStyle = theme.accent;
			ctx.fill();
		}
		return { x, y, label: s.label };
	});
}

export function renderLineChart(
	canvas: HTMLCanvasElement,
	samples: ChartPoint[],
	showDots: boolean,
): ChartPoint[] {
	// Scale the backing store by DPR for crisp rendering on high-DPI
	// displays. ctx.scale lets draw calls keep using CSS pixels.
	const { width, height } = (
		canvas.parentElement ?? canvas
	).getBoundingClientRect();
	const dpr = window.devicePixelRatio || 1;
	canvas.width = width * dpr;
	canvas.height = height * dpr;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return [];
	}
	ctx.scale(dpr, dpr);

	const theme = readTheme();
	const layout = layoutChart(ctx, samples, width, height, theme.family);
	drawAxes(ctx, layout, theme);
	return samples.length > 0
		? drawSeries(ctx, samples, layout, theme, showDots)
		: [];
}
