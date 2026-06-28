import "./live-networth.css";
import { settings, userdata } from "@common/utils/data/database";
import { hasAPIData } from "@common/utils/functions/api";
import { elementBuilder } from "@common/utils/functions/dom";
import { formatNumber, formatTime } from "@common/utils/functions/formatting";
import { requireContent } from "@common/utils/functions/requires";
import { getPageStatus, isAbroad, isFlying } from "@common/utils/functions/torn";
import { Feature } from "@features/feature";
import { createHomeCard, removeHomeCard } from "@features/home-cards/home-cards";

const CARD_ID = "ttHomeCardLiveNetworth";

let infoIconInterval: number | undefined;

async function showNetworth() {
	await requireContent();

	const { card, content } = await createHomeCard({
		id: CARD_ID,
		title: "Live Networth",
		defaultColumnId: "column1",
		defaultAfterTitle: "General Information",
		contentClass: "tt-live-networth-card",
	});
	updateHeaderNetworth(card);
	const list = document.createElement("ul");
	list.className = "info-cont-wrap";

	const table = elementBuilder({
		type: "table",
		class: "tt-networth-comparison",
		children: [
			elementBuilder({
				type: "tr",
				children: ["Type", "Value", "Change"].map((value) => elementBuilder({ type: "th", text: value })),
			}),
		],
	});

	for (const type of getNetworthTypes()) {
		addToTable(type);
	}

	list.appendChild(
		elementBuilder({
			type: "li",
			class: "comparison",
			children: [
				table,
				elementBuilder({
					type: "div",
					class: "tt-networth-footer",
					text: `Networth change compared to Torn's last known Networth (updated ${formatTime({ seconds: userdata.networth.timestamp }, { type: "ago" })})`,
				}),
			],
		}),
	);
	content.appendChild(list);

	function getNetworthTypes() {
		return [
			"Cash (Wallet and Vault)",
			"Points",
			"Items",
			"Bazaar",
			"Display Case",
			"Bank",
			"Trade",
			"Piggy Bank",
			"Stock Market",
			"Company",
			"Bookie",
			"Auction House",
			"Cayman",
			"Properties",
			"Enlisted Cars",
			"Item Market",
			"Loan",
			"Total",
		] as const;
	}

	type NetworthType = ReturnType<typeof getNetworthTypes>[number];

	function addToTable(type: NetworthType) {
		let current: number, previous: number;

		let nameNetworth = type.toLowerCase().replaceAll(" ", "");
		let nameStats = type.toLowerCase().replaceAll(" ", "_");
		if (type === "Trade") {
			nameNetworth = "pending";
			nameStats = "pending";
		} else if (type === "Cayman") nameStats = "overseas_bank";
		else if (type === "Items") nameStats = "inventory";
		else if (type === "Properties") nameStats = "property";
		else if (type === "Loan") nameStats = "loans";

		if (type.includes("Cash")) {
			current = userdata.networth.wallet + userdata.networth.vault;
			previous = userdata.personalstats.networth.wallet + userdata.personalstats.networth.vaults;
		} else {
			current = userdata.networth[nameNetworth];
			previous = userdata.personalstats.networth[nameStats];
		}
		if (current === previous) return;

		const isPositive = current > previous;

		table.appendChild(
			elementBuilder({
				type: "tr",
				children: [
					elementBuilder({ type: "td", text: type }),
					elementBuilder({ type: "td", text: `${formatNumber(current, { shorten: true, currency: true })}` }),
					elementBuilder({
						type: "td",
						text: `${formatNumber(current - previous, { shorten: true, currency: true, forceOperation: true })}`,
						class: isPositive ? "positive" : "negative",
					}),
				],
			}),
		);
	}
}

function updateHeaderNetworth(card: HTMLElement) {
	card.querySelector(".tt-live-networth-title-value")?.remove();
	const infoIcon = elementBuilder({
		type: "i",
		class: "networth-info-icon",
		attributes: {
			seconds: (Date.now() - userdata.date) / 1000,
			title: `Last updated ${formatTime({ seconds: userdata.networth.timestamp }, { type: "ago" })}`,
		},
	});
	card.querySelector(".tt-home-card-title-text")?.insertAdjacentElement(
		"afterend",
		elementBuilder({
			type: "span",
			class: "tt-live-networth-title-value",
			children: [formatNumber(userdata.networth.total, { currency: true }), infoIcon],
		}),
	);

	if (infoIconInterval) window.clearInterval(infoIconInterval);
	infoIconInterval = window.setInterval(() => {
		const seconds = parseInt(infoIcon.getAttribute("seconds")) + 1;

		if (!infoIcon.hasAttribute("aria-describedby"))
			infoIcon.setAttribute("title", `Last updated: ${formatTime({ milliseconds: Date.now() - seconds * 1000 }, { type: "ago" })}`);
		infoIcon.setAttribute("seconds", seconds.toString());
	}, 1000);
}

function cleanupNetworthTimers() {
	if (!infoIconInterval) return;

	window.clearInterval(infoIconInterval);
	infoIconInterval = undefined;
}

export default class LiveNetworthFeature extends Feature {
	constructor() {
		super("Live Networth", "home");
	}

	precondition() {
		return getPageStatus().access && !isFlying() && !isAbroad();
	}

	requirements() {
		if (!hasAPIData() || !settings.apiUsage.user.networth) return "No API access.";

		return true;
	}

	isEnabled() {
		return settings.pages.home.networthDetails;
	}

	async execute() {
		await showNetworth();
	}

	cleanup() {
		cleanupNetworthTimers();
		removeHomeCard(CARD_ID);
	}

	storageKeys() {
		return ["settings.pages.home.networthDetails", "userdata.networth"];
	}
}
