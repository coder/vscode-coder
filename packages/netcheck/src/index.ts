import {
	NetcheckApi,
	overallNetcheckSeverity,
	toError,
	type NetcheckData,
	type NetcheckInterface,
	type NetcheckReport,
	type NetcheckSeverity,
} from "@repo/shared";
import { sendCommand, subscribeNotifications } from "@repo/webview-shared";

import "./index.css";
import {
	bannerTitle,
	buildConnectivityItems,
	buildRegionRows,
	collectIssues,
	formatLatency,
	formatTriState,
	sectionSummary,
	severityLabel,
	type Issue,
} from "./render";

function main(): void {
	subscribeNotifications(NetcheckApi, {
		data: (data) => {
			try {
				renderPage(data, () => sendCommand(NetcheckApi.viewJson));
			} catch (err) {
				showError(`Failed to render network check: ${toError(err).message}`);
			}
		},
	});
	// Signal we're subscribed; the extension waits for this before sending.
	sendCommand(NetcheckApi.ready);
}

function renderPage({ host, report }: NetcheckData, onViewJson: () => void) {
	const root = document.getElementById("root");
	if (!root) {
		return;
	}

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
	root.replaceChildren(...children);
}

function renderHeading(host: string): HTMLElement {
	const header = document.createElement("header");
	header.className = "page-header";

	const eyebrow = document.createElement("p");
	eyebrow.className = "eyebrow";
	eyebrow.textContent = "Network Check";

	const heading = document.createElement("h1");
	heading.className = "deployment-host";
	heading.textContent = host;

	header.append(eyebrow, heading);
	return header;
}

function renderBanner(report: NetcheckReport): HTMLElement {
	const severity = overallNetcheckSeverity(report);
	const banner = document.createElement("div");
	banner.className = `status-banner severity-${severity}`;

	const dot = document.createElement("span");
	dot.className = "status-dot";

	const text = document.createElement("div");
	const title = document.createElement("p");
	title.className = "status-title";
	title.textContent = bannerTitle(severity);
	const detail = document.createElement("p");
	detail.className = "status-detail";
	detail.textContent = [
		sectionSummary("DERP & STUN", report.derp),
		sectionSummary("Local interfaces", report.interfaces),
	].join("  ·  ");
	text.append(title, detail);

	banner.append(dot, text);
	return banner;
}

function renderIssues(issues: Issue[]): HTMLElement {
	const list = document.createElement("ul");
	list.className = "issue-list";
	for (const issue of issues) {
		const item = document.createElement("li");
		item.className = `issue severity-${issue.kind}`;

		const kind = document.createElement("span");
		kind.className = "issue-kind";
		kind.textContent = issue.kind === "error" ? "Error" : "Warning";
		item.appendChild(kind);

		const message = document.createElement("span");
		message.className = "issue-message";
		message.textContent = issue.message;
		item.appendChild(message);

		if (issue.code) {
			const code = document.createElement("span");
			code.className = "issue-code";
			code.textContent = issue.code;
			item.appendChild(code);
		}
		list.appendChild(item);
	}
	return list;
}

function renderConnectivity(report: NetcheckReport): HTMLElement {
	const items = buildConnectivityItems(report);
	if (items.length === 0) {
		return renderEmptyMessage(
			"The connectivity probe returned no data. See Issues above or View JSON for details.",
		);
	}
	const grid = document.createElement("div");
	grid.className = "conn-grid";
	for (const item of items) {
		const cell = document.createElement("div");
		cell.className = "conn-item";

		const label = document.createElement("span");
		label.className = "conn-label";
		label.textContent = item.label;

		const value = document.createElement("span");
		value.className = `conn-value tone-${item.tone}`;
		value.textContent = item.value;

		cell.append(label, value);
		grid.appendChild(cell);
	}
	return grid;
}

function renderRegions(report: NetcheckReport): HTMLElement {
	const rows = buildRegionRows(report);
	if (rows.length === 0) {
		return renderEmptyMessage("No DERP regions in the deployment's relay map.");
	}

	const table = document.createElement("table");
	table.className = "report-table";
	table.appendChild(
		renderTableHead("Region", "Status", "Latency", "STUN", "Relay"),
	);

	const tbody = document.createElement("tbody");
	for (const row of rows) {
		const tr = document.createElement("tr");

		const name = document.createElement("td");
		name.className = "region-name";
		name.appendChild(document.createTextNode(row.name));
		if (row.preferred) {
			name.appendChild(renderBadge("Preferred"));
		}
		if (row.embeddedRelay) {
			name.appendChild(renderBadge("Embedded"));
		}

		const status = renderSeverityCell(row.severity);
		if (row.error) {
			status.title = row.error;
		}

		tr.append(
			name,
			status,
			renderCell(formatLatency(row.latencyMs)),
			renderCell(formatTriState(row.stun, { yes: "Yes", no: "Failed" })),
			renderCell(formatTriState(row.relay, { yes: "Yes", no: "Failed" })),
		);
		tbody.appendChild(tr);
	}
	table.appendChild(tbody);
	return table;
}

function renderInterfaces(interfaces: NetcheckInterface[]): HTMLElement {
	if (interfaces.length === 0) {
		return renderEmptyMessage("No active network interfaces found.");
	}

	const table = document.createElement("table");
	table.className = "report-table";
	table.appendChild(renderTableHead("Name", "MTU", "Addresses"));

	const tbody = document.createElement("tbody");
	for (const iface of interfaces) {
		const tr = document.createElement("tr");
		const addresses = renderCell(iface.addresses.join(", "));
		addresses.className = "addresses";
		tr.append(renderCell(iface.name), renderCell(String(iface.mtu)), addresses);
		tbody.appendChild(tr);
	}
	table.appendChild(tbody);
	return table;
}

function renderSection(title: string, body: HTMLElement): HTMLElement {
	const section = document.createElement("section");
	section.className = "report-section";
	const heading = document.createElement("h2");
	heading.textContent = title;
	const content = document.createElement("div");
	// Tables run edge-to-edge inside the card; everything else gets padding.
	content.className =
		body instanceof HTMLTableElement
			? "section-body section-body-flush"
			: "section-body";
	content.appendChild(body);
	section.append(heading, content);
	return section;
}

function renderTableHead(...labels: string[]): HTMLElement {
	const thead = document.createElement("thead");
	const tr = document.createElement("tr");
	for (const label of labels) {
		const th = document.createElement("th");
		th.textContent = label;
		tr.appendChild(th);
	}
	thead.appendChild(tr);
	return thead;
}

function renderCell(text: string): HTMLTableCellElement {
	const td = document.createElement("td");
	td.textContent = text;
	return td;
}

function renderSeverityCell(severity: NetcheckSeverity): HTMLTableCellElement {
	const td = document.createElement("td");
	const status = document.createElement("span");
	status.className = `severity-text severity-${severity}`;
	const dot = document.createElement("span");
	dot.className = "status-dot";
	status.append(dot, document.createTextNode(severityLabel(severity)));
	td.appendChild(status);
	return td;
}

function renderBadge(text: string): HTMLElement {
	const badge = document.createElement("span");
	badge.className = "badge";
	badge.textContent = text;
	return badge;
}

function renderEmptyMessage(text: string): HTMLElement {
	const p = document.createElement("p");
	p.className = "empty";
	p.textContent = text;
	return p;
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
