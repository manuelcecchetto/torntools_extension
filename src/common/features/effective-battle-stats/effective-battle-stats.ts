import "./effective-battle-stats.css";
import { settings } from "@common/utils/data/database";
import { checkDevice } from "@common/utils/functions/dom";
import { convertToNumber, dropDecimals, formatNumber } from "@common/utils/functions/formatting";
import { requireContent } from "@common/utils/functions/requires";
import { getPageStatus, isAbroad, isFlying } from "@common/utils/functions/torn";
import { Feature } from "@features/feature";
import { createHomeCard, createHomeCardRow, findHomePanelByTitle, removeHomeCard } from "@features/home-cards/home-cards";

const CARD_ID = "ttHomeCardEffectiveBattleStats";

async function showEffectiveBattleStats() {
	await requireContent();

	const statsContainer = findHomePanelByTitle("Battle Stats")?.querySelector<HTMLElement>("ul.info-cont-wrap");
	if (!statsContainer) return;

	const { content } = await createHomeCard({
		id: CARD_ID,
		title: "Effective Battle Stats",
		defaultColumnId: "column1",
		defaultAfterTitle: "Battle Stats",
		contentClass: "battle tt-effective-battle-stats-card",
	});
	const list = document.createElement("ul");
	list.className = "info-cont-wrap";

	let effectiveTotal = 0;
	const stats = ["Strength", "Defense", "Speed", "Dexterity"];
	for (const stat of stats) {
		const row = findStatRow(statsContainer, stat);
		if (!row) continue;

		const base = convertToNumber(row.querySelector(".desc")?.textContent ?? "0");
		const modifierText = row.querySelector(".mod")?.textContent.trim() ?? "";
		const modifierOperator = modifierText.charAt(0);
		const modifierValue = (parseInt(modifierText.replace(/\D/g, "")) || 0) / 100;
		let modifier = 1;
		if (modifierOperator === "+") modifier += modifierValue;
		else if (modifierOperator === "−" || modifierOperator === "-") modifier -= modifierValue;
		const effective = dropDecimals(base * modifier);

		effectiveTotal += effective;
		list.appendChild(createHomeCardRow(stat, formatNumber(effective), "stats-row"));
	}

	list.appendChild(createHomeCardRow("Total", formatNumber(effectiveTotal), "stats-row last"));
	content.appendChild(list);
}

function findStatRow(statsContainer: HTMLElement, stat: string): HTMLElement | null {
	return (
		Array.from(statsContainer.querySelectorAll<HTMLElement>(":scope > li")).find(
			(row) => row.querySelector(".divider .label, .divider span")?.textContent?.trim() === stat,
		) ?? null
	);
}

export default class EffectiveBattleStatsFeature extends Feature {
	constructor() {
		super("Effective Battle Stats", "home");
	}

	precondition() {
		return getPageStatus().access && !isFlying() && !isAbroad();
	}

	isEnabled() {
		return settings.pages.home.effectiveStats;
	}

	async requirements() {
		await checkDevice();
		return true;
	}

	async execute() {
		await showEffectiveBattleStats();
	}

	cleanup() {
		removeHomeCard(CARD_ID);
	}

	storageKeys() {
		return ["settings.pages.home.effectiveStats"];
	}
}
