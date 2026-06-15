import {
	overallNetcheckSeverity,
	type NetcheckData,
	type NetcheckInterface,
	type NetcheckReport,
	type NetcheckSeverity,
} from "@repo/shared";
import { emptyMessage, viewJsonAction } from "@repo/webview-shared";

import { buildConnectivityItems } from "./connectivity";
import { formatLatency, formatTriState } from "./format";
import {
	bannerTitle,
	collectIssues,
	sectionSummary,
	severityLabel,
	type Issue,
} from "./health";
import { buildRegionRows, type RegionRow } from "./regions";

export function renderPage(
	{ host, report }: NetcheckData,
	onViewJson: () => void,
): HTMLElement[] {
	const children = [renderHeading(host), renderBanner(report)];

	const issues = collectIssues(report);
	if (issues.length > 0) {
		children.push(renderSection("Issues", renderIssues(issues)));
	}
	children.push(
		renderSection("Connectivity", renderConnectivity(report)),
		renderSection("DERP relay regions", renderRegions(report)),
		renderSection(
			"Local interfaces",
			renderInterfaces(report.interfaces.interfaces),
		),
		viewJsonAction(onViewJson),
	);
	return children;
}

function renderHeading(host: string): HTMLElement {
	const header = el("header", "page-header");
	header.append(
		el("p", "eyebrow", "Network Check"),
		el("h1", "deployment-host", host),
	);
	return header;
}

function renderBanner(report: NetcheckReport): HTMLElement {
	const severity = overallNetcheckSeverity(report);
	const banner = el("div", `status-banner severity-${severity}`);
	const text = el("div");
	text.append(
		el("p", "status-title", bannerTitle(severity)),
		el(
			"p",
			"status-detail",
			[
				`DERP & STUN: ${sectionSummary(report.derp)}`,
				`Local interfaces: ${sectionSummary(report.interfaces)}`,
			].join("  ·  "),
		),
	);
	banner.append(el("span", "status-dot"), text);
	return banner;
}

function renderIssues(issues: Issue[]): HTMLElement {
	const list = el("ul", "issue-list");
	for (const issue of issues) {
		const item = el("li", `issue severity-${issue.kind}`);
		item.append(
			el("span", "issue-kind", issue.kind === "error" ? "Error" : "Warning"),
			el("span", "issue-message", issue.message),
		);
		if (issue.code) {
			item.append(el("span", "issue-code", issue.code));
		}
		list.append(item);
	}
	return list;
}

function renderConnectivity(report: NetcheckReport): HTMLElement {
	const items = buildConnectivityItems(report);
	if (items.length === 0) {
		return emptyMessage(
			"The connectivity probe returned no data. Use View JSON for details.",
		);
	}
	const grid = el("div", "conn-grid");
	for (const item of items) {
		const cell = el("div", "conn-item");
		cell.append(
			el("span", "conn-label", item.label),
			el("span", `conn-value tone-${item.tone}`, item.value),
		);
		grid.append(cell);
	}
	return grid;
}

function renderRegions(report: NetcheckReport): HTMLElement {
	const rows = buildRegionRows(report);
	if (rows.length === 0) {
		return emptyMessage("No DERP regions in the deployment's relay map.");
	}
	return renderTable(
		["Region", "Status", "Latency", "STUN", "Relay"],
		rows,
		renderRegionRow,
	);
}

function renderRegionRow(row: RegionRow): HTMLTableRowElement {
	const name = el("td", "region-name", row.name);
	if (row.preferred) {
		name.append(badge("Preferred"));
	}
	if (row.embeddedRelay) {
		name.append(badge("Embedded"));
	}

	const status = renderSeverityCell(row.severity);
	if (row.error) {
		status.title = row.error;
	}

	const tr = el("tr");
	tr.append(
		name,
		status,
		el("td", undefined, formatLatency(row.latencyMs)),
		el("td", undefined, formatTriState(row.stun)),
		el("td", undefined, formatTriState(row.relay)),
	);
	return tr;
}

function renderInterfaces(interfaces: NetcheckInterface[]): HTMLElement {
	if (interfaces.length === 0) {
		return emptyMessage("No active network interfaces found.");
	}
	return renderTable(["Name", "MTU", "Addresses"], interfaces, (iface) => {
		const tr = el("tr");
		tr.append(
			el("td", undefined, iface.name),
			el("td", undefined, String(iface.mtu)),
			el("td", "addresses", iface.addresses.join(", ")),
		);
		return tr;
	});
}

function renderSection(title: string, body: HTMLElement): HTMLElement {
	const section = el("section", "report-section");
	// Tables flush to the card edges via `.section-body:has(> table)` in CSS.
	const content = el("div", "section-body");
	content.append(body);
	section.append(el("h2", undefined, title), content);
	return section;
}

function renderTable<T>(
	headers: string[],
	rows: T[],
	renderRow: (row: T) => HTMLTableRowElement,
): HTMLTableElement {
	const table = el("table", "report-table");
	table.append(renderTableHead(...headers));
	const tbody = el("tbody");
	for (const row of rows) {
		tbody.append(renderRow(row));
	}
	table.append(tbody);
	return table;
}

function renderTableHead(...headers: string[]): HTMLElement {
	const thead = el("thead");
	const tr = el("tr");
	tr.append(...headers.map((header) => el("th", undefined, header)));
	thead.append(tr);
	return thead;
}

function renderSeverityCell(severity: NetcheckSeverity): HTMLTableCellElement {
	const td = el("td");
	const status = el("span", `severity-text severity-${severity}`);
	status.append(
		el("span", "status-dot"),
		document.createTextNode(severityLabel(severity)),
	);
	td.append(status);
	return td;
}

/** Create an element with an optional class and text content. */
function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) {
		node.className = className;
	}
	if (text !== undefined) {
		node.textContent = text;
	}
	return node;
}

function badge(text: string): HTMLElement {
	return el("span", "badge", text);
}
