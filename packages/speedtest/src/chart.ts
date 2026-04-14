/**
 * Lightweight canvas line chart for speedtest results.
 * No dependencies — uses Canvas 2D API with VS Code theme colors.
 */

export interface ChartPoint {
	x: number;
	y: number;
	label: string;
}

export interface ChartData {
	labels: string[];
	values: number[];
	pointLabels: string[];
}

/**
 * Draw a line chart on the given canvas and return hit-test positions.
 */
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

	const pad = { top: 24, right: 24, bottom: 52, left: 72 };
	const plotW = width - pad.left - pad.right;
	const plotH = height - pad.top - pad.bottom;
	const maxVal = Math.max(...data.values, 1) * 1.1;
	const n = data.values.length;

	// Coordinate helpers
	const xAt = (i: number) => pad.left + (i / Math.max(n - 1, 1)) * plotW;
	const yAt = (v: number) => pad.top + plotH - (v / maxVal) * plotH;

	// Read VS Code theme
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

	// ── Axes ──

	// Y-axis grid lines and labels
	ctx.strokeStyle = grid;
	ctx.lineWidth = 1;
	ctx.fillStyle = fg;
	ctx.font = `1em ${family}`;
	ctx.textAlign = "right";
	for (let i = 0; i <= 5; i++) {
		const y = yAt((i / 5) * maxVal);
		ctx.beginPath();
		ctx.moveTo(pad.left, y);
		ctx.lineTo(pad.left + plotW, y);
		ctx.stroke();
		ctx.fillText(((i / 5) * maxVal).toFixed(0), pad.left - 12, y + 5);
	}

	// Bottom axis line
	ctx.strokeStyle = fg;
	ctx.beginPath();
	ctx.moveTo(pad.left, pad.top + plotH);
	ctx.lineTo(pad.left + plotW, pad.top + plotH);
	ctx.stroke();

	// X-axis labels (auto-thinned, deduped)
	ctx.textAlign = "center";
	ctx.fillStyle = fg;
	const maxLabels = Math.floor(plotW / 60);
	const step = Math.max(1, Math.ceil(n / maxLabels));
	let lastDrawnLabel = "";
	let lastDrawnX = -Infinity;
	for (let i = 0; i < n; i += step) {
		if (data.labels[i] !== lastDrawnLabel) {
			ctx.fillText(data.labels[i], xAt(i), height - pad.bottom + 24);
			lastDrawnLabel = data.labels[i];
			lastDrawnX = xAt(i);
		}
	}
	const last = n - 1;
	if (
		last > 0 &&
		last % step !== 0 &&
		data.labels[last] !== lastDrawnLabel &&
		xAt(last) - lastDrawnX > 50
	) {
		ctx.fillText(data.labels[last], xAt(last), height - pad.bottom + 24);
	}

	// Axis titles
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

	// ── Series ──

	const baseline = pad.top + plotH;

	// Fill area
	ctx.beginPath();
	ctx.moveTo(xAt(0), baseline);
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

	// Line
	ctx.beginPath();
	ctx.moveTo(xAt(0), yAt(data.values[0]));
	for (let i = 1; i < n; i++) {
		ctx.lineTo(xAt(i), yAt(data.values[i]));
	}
	ctx.strokeStyle = accent;
	ctx.lineWidth = 2;
	ctx.stroke();

	// Dots and hit-test positions
	const showDots = n <= 50;
	const points: ChartPoint[] = [];
	for (let i = 0; i < n; i++) {
		const x = xAt(i);
		const y = yAt(data.values[i]);
		if (showDots) {
			ctx.beginPath();
			ctx.arc(x, y, 4, 0, Math.PI * 2);
			ctx.fillStyle = accent;
			ctx.fill();
		}
		points.push({ x, y, label: data.pointLabels[i] });
	}
	return points;
}
