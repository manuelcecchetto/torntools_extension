import "./home-cards.css";
import { ttStorage } from "@common/utils/context";
import { filters, localdata } from "@common/utils/data/database";
import { elementBuilder } from "@common/utils/functions/dom";
import { requireElement } from "@common/utils/functions/requires";
import { torntools } from "@common/utils/icons/torntools";

const SORTABLE_LIST_SELECTOR = ".content .sortable-list";
const SORTABLE_BOX_SELECTOR = ".sortable-box";

type HomeCardColumns = Record<string, string[]>;

interface StoredHomeCards {
	columns?: HomeCardColumns;
}

interface HomeCardOptions {
	id: string;
	title: string;
	defaultColumnId?: "column0" | "column1";
	defaultAfterTitle?: string;
	contentClass?: string;
}

interface HomeCard {
	card: HTMLElement;
	content: HTMLElement;
}

let restoreTimeout: number | undefined;
let persistTimeout: number | undefined;
let observersStarted = false;
let restoringLayout = false;

export async function createHomeCard(options: HomeCardOptions): Promise<HomeCard> {
	await requireElement(SORTABLE_LIST_SELECTOR);

	const existingCard = document.getElementById(options.id);
	if (existingCard?.classList.contains("tt-home-card")) {
		const existingContent = existingCard.querySelector<HTMLElement>(":scope > .tt-home-card-body > .cont-gray");
		const titleText = existingCard.querySelector<HTMLElement>(".tt-home-card-title-text");
		if (existingContent) {
			existingContent.className = ["cont-gray", "bottom-round", options.contentClass].filter(Boolean).join(" ");
			existingContent.replaceChildren();
			if (titleText) titleText.textContent = options.title;

			return { card: existingCard, content: existingContent };
		}
		existingCard.remove();
	}

	const collapsed = filters.containers[options.id] ?? false;
	const content = elementBuilder({ type: "div", class: ["cont-gray", "bottom-round", options.contentClass].filter(Boolean) });
	const body = elementBuilder({
		type: "div",
		class: "bottom-round tt-home-card-body",
		style: { display: collapsed ? "none" : "block" },
		children: [content],
	});
	const title = elementBuilder({
		type: "div",
		class: ["title", "main-title", "title-black", "top-round", collapsed ? null : "active"].filter(Boolean),
		attributes: { role: "table" },
		children: [
			elementBuilder({
				type: "div",
				class: "arrow-wrap",
				children: [
					elementBuilder({
						type: "a",
						class: "accordion-header-arrow right",
						href: "#/",
						attributes: { role: "button", "aria-label": `${collapsed ? "Open" : "Close"} ${options.title} panel`, tabindex: "0" },
					}),
				],
			}),
			elementBuilder({ type: "div", class: "move-wrap", children: [elementBuilder({ type: "i", class: "accordion-header-move right" })] }),
			elementBuilder({
				type: "h5",
				class: "box-title",
				attributes: { tabindex: "0" },
				children: [
					elementBuilder({ type: "span", class: "tt-home-card-logo", children: [torntools()] }),
					elementBuilder({ type: "span", class: "tt-home-card-title-text", text: options.title }),
				],
			}),
		],
	});
	const card = elementBuilder({
		type: "div",
		id: options.id,
		class: "sortable-box t-blue-cont h tt-home-card",
		dataset: { ttHomeCard: "true" },
		children: [title, body],
	});

	const arrow = card.querySelector<HTMLAnchorElement>(".accordion-header-arrow");
	arrow?.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		setHomeCardCollapsed(card, !isHomeCardCollapsed(card), true);
	});

	insertHomeCard(card, options);
	scheduleLayoutRestore();

	return { card, content };
}

export function removeHomeCard(id: string) {
	document.getElementById(id)?.remove();
}

export function findHomePanelByTitle(title: string): HTMLElement | null {
	const headers = Array.from(document.querySelectorAll<HTMLElement>(`${SORTABLE_LIST_SELECTOR} ${SORTABLE_BOX_SELECTOR}:not(.tt-home-card) h5.box-title`));
	const header = headers.find((header) => header.textContent?.trim() === title);

	return header?.closest<HTMLElement>(SORTABLE_BOX_SELECTOR) ?? null;
}

export function createHomeCardRow(label: string, value: string | number, className?: string): HTMLElement {
	return elementBuilder({
		type: "li",
		class: className,
		children: [
			elementBuilder({ type: "div", class: "divider", children: [elementBuilder({ type: "span", text: label })] }),
			elementBuilder({ type: "div", class: "desc", children: [elementBuilder({ type: "span", text: value })] }),
		],
	});
}

function insertHomeCard(card: HTMLElement, options: HomeCardOptions) {
	const storedColumn = getStoredColumnForCard(card.id);
	const defaultColumn = document.getElementById(options.defaultColumnId ?? "column1") ?? document.querySelector<HTMLElement>(SORTABLE_LIST_SELECTOR);
	const sourceCard = !storedColumn && options.defaultAfterTitle ? findHomePanelByTitle(options.defaultAfterTitle) : null;

	if (sourceCard?.parentElement) {
		sourceCard.insertAdjacentElement("afterend", card);
	} else {
		(document.getElementById(storedColumn) ?? defaultColumn)?.appendChild(card);
	}
}

function scheduleLayoutRestore() {
	if (restoreTimeout) window.clearTimeout(restoreTimeout);

	restoreTimeout = window.setTimeout(() => {
		restoreHomeCardLayout();
		setupHomeCardPersistence();
		refreshTornSortable();
	}, 50);
}

function restoreHomeCardLayout() {
	const columns = getStoredColumns();
	if (!Object.keys(columns).length) return;

	restoringLayout = true;
	try {
		for (const [columnId, storedIds] of Object.entries(columns)) {
			const column = document.getElementById(columnId);
			if (!column) continue;

			for (const id of storedIds) {
				const card = document.getElementById(id);
				if (!card?.classList.contains("tt-home-card")) continue;

				const nextElement = storedIds
					.slice(storedIds.indexOf(id) + 1)
					.map((nextId) => document.getElementById(nextId))
					.find((element) => !!element && element !== card && element.closest(SORTABLE_LIST_SELECTOR) === column);

				if (nextElement) column.insertBefore(card, nextElement);
				else column.appendChild(card);
			}
		}
	} finally {
		window.setTimeout(() => {
			restoringLayout = false;
		}, 0);
	}
}

function setupHomeCardPersistence() {
	if (observersStarted) return;
	observersStarted = true;

	for (const column of getSortableLists()) {
		new MutationObserver(() => scheduleLayoutPersist()).observe(column, { childList: true });
	}
}

function scheduleLayoutPersist() {
	if (restoringLayout) return;
	if (!document.querySelector(".tt-home-card")) return;
	if (persistTimeout) window.clearTimeout(persistTimeout);

	persistTimeout = window.setTimeout(() => {
		persistHomeCardLayout().catch((error) => console.error("TT - Failed to save home card layout.", error));
	}, 250);
}

async function persistHomeCardLayout() {
	const columns: HomeCardColumns = {};

	for (const column of getSortableLists()) {
		columns[column.id] = Array.from(column.querySelectorAll<HTMLElement>(`:scope > ${SORTABLE_BOX_SELECTOR}`))
			.map((element) => element.id)
			.filter(Boolean);
	}

	await ttStorage.change({ localdata: { homeCards: { columns } } });
}

function getSortableLists(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>(SORTABLE_LIST_SELECTOR));
}

function getStoredColumns(): HomeCardColumns {
	return ((localdata.homeCards ?? {}) as StoredHomeCards).columns ?? {};
}

function getStoredColumnForCard(cardId: string): string | null {
	const columns = getStoredColumns();
	const entry = Object.entries(columns).find(([, ids]) => ids.includes(cardId));

	return entry?.[0] ?? null;
}

function isHomeCardCollapsed(card: HTMLElement) {
	return card.querySelector<HTMLElement>(".tt-home-card-body")?.style.display === "none";
}

function setHomeCardCollapsed(card: HTMLElement, collapsed: boolean, persist: boolean) {
	const body = card.querySelector<HTMLElement>(".tt-home-card-body");
	const title = card.querySelector<HTMLElement>(":scope > .title");
	const arrow = card.querySelector<HTMLElement>(".accordion-header-arrow");
	const titleText = card.querySelector<HTMLElement>(".tt-home-card-title-text")?.textContent ?? "TornTools";

	if (body) body.style.display = collapsed ? "none" : "block";
	title?.classList.toggle("active", !collapsed);
	arrow?.setAttribute("aria-label", `${collapsed ? "Open" : "Close"} ${titleText} panel`);

	if (persist) void ttStorage.change({ filters: { containers: { [card.id]: collapsed } } });
}

function refreshTornSortable() {
	const jquery = (window as unknown as { jQuery?: any; $?: any }).jQuery ?? (window as unknown as { $?: any }).$;
	if (!jquery) return;

	try {
		const sortableLists = jquery(`${SORTABLE_LIST_SELECTOR}.ui-sortable`);
		if (sortableLists.sortable) sortableLists.sortable("refresh");
	} catch {
		// Torn may change or remove jQuery UI; the cards still render without native dragging.
	}
}
