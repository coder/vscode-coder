import {
	overallNetcheckSeverity,
	type NetcheckData,
	type NetcheckInterface,
	type NetcheckReport,
	type NetcheckSeverity,
} from "@repo/shared";

import { buildConnectivityItems } from "./connectivity";
import { badge, el, emptyMessage } from "./dom";
import { formatLatency, formatTriState } from "./format";
import {
	bannerTitle,
	collectIssues,
	sectionSummary,
	severityLabel,
	type Issue,
} from "./health";
import { buildRegionRows } from "./regions";

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
		renderActions(onViewJson),
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
				sectionSummary("DERP & STUN", report.derp),
				sectionSummary("Local interfaces", report.interfaces),
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
			"The connectivity probe returned no data. See Issues above or View JSON for details.",
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

	const table = el("table", "report-table");
	table.append(renderTableHead("Region", "Status", "Latency", "STUN", "Relay"));

	const tbody = el("tbody");
	for (const row of rows) {
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
			el(
				"td",
				undefined,
				formatTriState(row.stun, { yes: "Yes", no: "Failed" }),
			),
			el(
				"td",
				undefined,
				formatTriState(row.relay, { yes: "Yes", no: "Failed" }),
			),
		);
		tbody.append(tr);
	}
	table.append(tbody);
	return table;
}

function renderInterfaces(interfaces: NetcheckInterface[]): HTMLElement {
	if (interfaces.length === 0) {
		return emptyMessage("No active network interfaces found.");
	}

	const table = el("table", "report-table");
	table.append(renderTableHead("Name", "MTU", "Addresses"));

	const tbody = el("tbody");
	for (const iface of interfaces) {
		const tr = el("tr");
		tr.append(
			el("td", undefined, iface.name),
			el("td", undefined, String(iface.mtu)),
			el("td", "addresses", iface.addresses.join(", ")),
		);
		tbody.append(tr);
	}
	table.append(tbody);
	return table;
}

function renderSection(title: string, body: HTMLElement): HTMLElement {
	const section = el("section", "report-section");
	// Tables run edge-to-edge inside the card; everything else gets padding.
	const content = el(
		"div",
		body instanceof HTMLTableElement
			? "section-body section-body-flush"
			: "section-body",
	);
	content.append(body);
	section.append(el("h2", undefined, title), content);
	return section;
}

function renderTableHead(...labels: string[]): HTMLElement {
	const thead = el("thead");
	const tr = el("tr");
	tr.append(...labels.map((label) => el("th", undefined, label)));
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

function renderActions(onViewJson: () => void): HTMLElement {
	const actions = el("div", "actions");
	const viewBtn = el("button", undefined, "View JSON");
	viewBtn.addEventListener("click", onViewJson);
	actions.append(viewBtn);
	return actions;
}
