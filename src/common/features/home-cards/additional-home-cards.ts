import "./additional-home-cards.css";
import { ITEM_RESOLVER, ttStorage } from "@common/utils/context";
import { attackHistory, factiondata, factionStakeouts, filters, localdata, settings, stakeouts, stockdata, userdata } from "@common/utils/data/database";
import { hasAPIData } from "@common/utils/functions/api";
import { elementBuilder } from "@common/utils/functions/dom";
import { convertToNumber, dropDecimals, formatNumber, formatTime } from "@common/utils/functions/formatting";
import { requireContent } from "@common/utils/functions/requires";
import { countdownTimers, removeCountdownTimer } from "@common/utils/functions/timers";
import { getPageStatus, isAbroad, isFlying, LINKS, TAX_RATES } from "@common/utils/functions/torn";
import { TO_MILLIS } from "@common/utils/functions/utilities";
import { Feature } from "@features/feature";
import { createHomeCard, findHomePanelByTitle, removeHomeCard } from "@features/home-cards/home-cards";

const CARD_IDS = {
	battleStatGrowth: "ttHomeCardBattleStatGrowth",
	cooldownTimers: "ttHomeCardCooldownTimers",
	dailyChecklist: "ttHomeCardDailyChecklist",
	factionStatus: "ttHomeCardFactionStatus",
	travelProfitFinder: "ttHomeCardTravelProfitFinder",
	crimeProgress: "ttHomeCardCrimeProgress",
	marketWatchlist: "ttHomeCardMarketWatchlist",
	targetShortlist: "ttHomeCardTargetShortlist",
	loadoutQuality: "ttHomeCardLoadoutQuality",
} as const;

const STAT_KEYS = ["strength", "defense", "speed", "dexterity"] as const;
const HOME_CARD_HISTORY_LIMIT = 120;
const HISTORY_KEEP_FOR = TO_MILLIS.DAYS * 90;
const SALES_TAX = TAX_RATES.salesTaxPercentage;
const ANONYMOUS_TAX = TAX_RATES.sellAnonymouslyPercentage;

type CardId = (typeof CARD_IDS)[keyof typeof CARD_IDS];
type StatKey = (typeof STAT_KEYS)[number];
type AnyRecord = Record<string, any>;

interface BattleStatsSnapshot extends Record<StatKey, number> {
	timestamp: number;
	total: number;
}

interface HomeCardsLocaldata {
	battleStatsHistory?: BattleStatsSnapshot[];
}

interface RowOptions {
	className?: string;
	href?: string;
	title?: string;
}

interface CountryInformation {
	name: string;
	cost: number;
	time: number;
}

const COUNTRIES: Record<string, CountryInformation> = {
	Argentina: { name: "Argentina", cost: 17850, time: 158 },
	Canada: { name: "Canada", cost: 7650, time: 39 },
	"Cayman Islands": { name: "Cayman Islands", cost: 8500, time: 33 },
	China: { name: "China", cost: 29750, time: 229 },
	Hawaii: { name: "Hawaii", cost: 9350, time: 127 },
	Japan: { name: "Japan", cost: 27200, time: 213 },
	Mexico: { name: "Mexico", cost: 5525, time: 24 },
	"South Africa": { name: "South Africa", cost: 34000, time: 282 },
	Switzerland: { name: "Switzerland", cost: 22950, time: 166 },
	UAE: { name: "UAE", cost: 27200, time: 257 },
	"United Kingdom": { name: "United Kingdom", cost: 15300, time: 151 },
};

async function showAdditionalHomeCards() {
	await requireContent();
	removeAdditionalHomeCardTimers();

	for (const buildCard of [
		showBattleStatGrowth,
		showCooldownTimers,
		showDailyChecklist,
		showFactionStatus,
		showTravelProfitFinder,
		showCrimeProgress,
		showMarketWatchlist,
		showTargetShortlist,
		showLoadoutQuality,
	]) {
		await buildCard().catch((error) => console.error("TT - Failed to build a home card.", error));
	}
}

function removeAdditionalHomeCardTimers() {
	removeCountdownTimer((timer) => {
		const card = timer.closest<HTMLElement>(".tt-home-card");
		return !card || !(Object.values(CARD_IDS) as string[]).includes(card.id);
	});
}

async function showBattleStatGrowth() {
	const list = await createCardList(CARD_IDS.battleStatGrowth, "Battle Stat Growth", {
		defaultColumnId: "column1",
		defaultAfterTitle: "Battle Stats",
		contentClass: "battle tt-battle-stat-growth-card",
	});
	const current = getBattleStatsSnapshot();
	if (!current) {
		appendNote(list, "Battle stat API data is not available yet.");
		return;
	}

	const history = getBattleStatsHistory();
	const todayBaseline = getTodaysBaselineSnapshot(history, current.timestamp);
	const weekly = getSnapshotBefore(history, current.timestamp - TO_MILLIS.DAYS * 7);
	const strongest = STAT_KEYS.map((stat) => ({ stat, value: current[stat] })).toSorted((a, b) => b.value - a.value)[0];

	appendRow(list, "Current total", formatNumber(current.total));
	appendGrowthRow(list, "Today", todayBaseline ? current.total - todayBaseline.total : null);
	appendGrowthRow(list, "7 day growth", weekly ? current.total - weekly.total : null);
	appendRow(list, "Strongest stat", `${capitalizeStat(strongest.stat)} (${formatNumber(strongest.value, { shorten: true })})`);
	appendNote(list, getBattleStatsGrowthNote(todayBaseline, current.timestamp));

	await recordBattleStatsSnapshot(current, history);
}

async function showCooldownTimers() {
	const list = await createCardList(CARD_IDS.cooldownTimers, "Cooldowns & Timers", {
		defaultColumnId: "column0",
		defaultAfterTitle: "General Information",
		contentClass: "tt-cooldown-timers-card",
	});

	appendRow(list, "Energy full", createRelativeCountdownValue(getNumber(userdata.energy?.fulltime), "Full"), { href: LINKS.gym });
	appendRow(list, "Nerve full", createRelativeCountdownValue(getNumber(userdata.nerve?.fulltime), "Full"), { href: LINKS.crimes });
	appendRow(list, "Happy full", createRelativeCountdownValue(getNumber(userdata.happy?.fulltime), "Full"));
	appendRow(list, "Drug cooldown", createRelativeCountdownValue(getNumber(userdata.cooldowns?.drug)), { href: LINKS.items_drug });
	appendRow(list, "Booster cooldown", createRelativeCountdownValue(getNumber(userdata.cooldowns?.booster)), { href: LINKS.items_booster });
	appendRow(list, "Medical cooldown", createRelativeCountdownValue(getNumber(userdata.cooldowns?.medical)), { href: LINKS.items_medical });

	const educationLeft = getNumber((userdata as AnyRecord).education_timeleft);
	if (educationLeft !== null)
		appendRow(list, "Education", educationLeft > 0 ? createRelativeCountdownValue(educationLeft, "Complete") : "No active course", {
			href: LINKS.education,
		});

	const bankUntil = getNumber(userdata.money?.city_bank?.until);
	if (bankUntil) appendRow(list, "Bank investment", createAbsoluteCountdownValue(bankUntil * TO_MILLIS.SECONDS), { href: LINKS.bank });
}

async function showDailyChecklist() {
	const list = await createCardList(CARD_IDS.dailyChecklist, "Daily Checklist", {
		defaultColumnId: "column0",
		defaultAfterTitle: "General Information",
		contentClass: "tt-home-card-checklist",
	});

	appendChecklistRow(list, "Spend energy", isBarBelowMaximum(userdata.energy), getBarText(userdata.energy), LINKS.gym);
	appendChecklistRow(list, "Spend nerve", isBarBelowMaximum(userdata.nerve), getBarText(userdata.nerve), LINKS.crimes);
	appendChecklistRow(list, "Energy refill", !!userdata.refills?.energy, userdata.refills?.energy ? "Used" : "Available", LINKS.points);
	appendChecklistRow(list, "Nerve refill", !!userdata.refills?.nerve, userdata.refills?.nerve ? "Used" : "Available", LINKS.points);
	appendChecklistRow(
		list,
		"Drug cooldown",
		getNumber(userdata.cooldowns?.drug) !== 0,
		getNumber(userdata.cooldowns?.drug) ? formatRelativeSeconds(getNumber(userdata.cooldowns?.drug)) : "Ready",
		LINKS.items_drug,
	);
	appendChecklistRow(
		list,
		"Booster cooldown",
		getNumber(userdata.cooldowns?.booster) !== 0,
		getNumber(userdata.cooldowns?.booster) ? formatRelativeSeconds(getNumber(userdata.cooldowns?.booster)) : "Ready",
		LINKS.items_booster,
	);

	const educationLeft = getNumber((userdata as AnyRecord).education_timeleft);
	const finishedEducation = Array.isArray((userdata as AnyRecord).education_completed) && Array.isArray((userdata as AnyRecord).education_perks);
	appendChecklistRow(
		list,
		"Education course",
		educationLeft !== 0 || finishedEducation,
		educationLeft && educationLeft > 0 ? formatRelativeSeconds(educationLeft) : finishedEducation ? "Complete/idle" : "Start one",
		LINKS.education,
	);

	const missionCount = getMissionCount();
	appendChecklistRow(
		list,
		"Missions",
		missionCount === null || missionCount === 0,
		missionCount === null ? "No data" : missionCount ? `${missionCount} open` : "Clear",
		LINKS.missions,
	);
}

async function showFactionStatus() {
	const list = await createCardList(CARD_IDS.factionStatus, "Faction War / Chain Status", {
		defaultColumnId: "column0",
		defaultAfterTitle: "Faction Information",
		contentClass: "tt-faction-status-card",
	});
	const factionName = userdata.faction?.name ?? (factiondata as AnyRecord).basic?.name;
	if (!factionName) {
		appendNote(list, "No faction data available.");
		return;
	}

	appendRow(list, "Faction", factionName, { href: LINKS.faction });
	const factionStakeout = factionStakeouts.list?.find((entry) => entry.id === userdata.faction?.id);
	const chain =
		getNumber((factiondata as AnyRecord).chain?.current) ?? getNumber((userdata as AnyRecord).chain?.current) ?? getNumber(factionStakeout?.info?.chain);
	appendRow(list, "Current chain", chain === null ? "Not cached" : formatNumber(chain), { href: LINKS.chain });

	const war = getPrimaryRankedWar();
	appendRow(list, "Ranked war", war ?? "None planned", { href: LINKS.faction__ranked_war, className: war ? "tt-home-card-row-warning" : undefined });
	appendRow(list, "Raid / territory", getWarSummary(), { href: LINKS.faction });

	if (!appendOrganizedCrimeRows(list)) {
		const userCrime = getNumber((factiondata as AnyRecord).userCrime) ?? getNumber((userdata as AnyRecord).userCrime);
		if (userCrime === null) appendRow(list, "Your OC", "Not cached", { href: LINKS.organizedCrimes });
		else if (userCrime > 0)
			appendRow(
				list,
				"Your OC",
				userCrime > Date.now() ? formatTime({ milliseconds: userCrime - Date.now() }, { type: "timer", daysToHours: true }) : "Ready",
				{ href: LINKS.organizedCrimes },
			);
		else appendRow(list, "Your OC", "No active legacy OC", { href: LINKS.organizedCrimes });
	}
}

async function showTravelProfitFinder() {
	const list = await createCardList(CARD_IDS.travelProfitFinder, "Travel Profit Finder", {
		defaultColumnId: "column0",
		defaultAfterTitle: "Travel Information",
		contentClass: "tt-travel-profit-card",
	});

	if (!ITEM_RESOLVER.hasFullItems()) {
		appendNote(list, "Requires Torn item market data from the API.");
		return;
	}

	const { capacity, breakdown } = getTravelCapacity();
	const bestItems = ITEM_RESOLVER.getAllFullItems()
		.map((item) => {
			const country = item.value.vendor?.country ? COUNTRIES[item.value.vendor.country] : null;
			const buyPrice = item.value.buy_price;
			const marketPrice = item.value.market_price;
			if (!country || !buyPrice || !marketPrice) return null;

			const totalCost = buyPrice * capacity + country.cost;
			const gross = marketPrice * capacity;
			const salesTax = filters.abroadItems.taxes.includes("salestax") ? Math.ceil((gross * SALES_TAX) / 100) : 0;
			const anonymousTax = filters.abroadItems.taxes.includes("anonymous") ? Math.ceil((gross * ANONYMOUS_TAX) / 100) : 0;
			const profit = gross - totalCost - salesTax - anonymousTax;
			const profitPerMinute = dropDecimals(profit / (country.time * 2));

			return { item, country, profit, profitPerMinute };
		})
		.filter((item): item is NonNullable<typeof item> => !!item)
		.toSorted((a, b) => b.profitPerMinute - a.profitPerMinute)
		.slice(0, 3);

	if (!bestItems.length) {
		appendNote(list, "No profitable abroad vendor items found.");
		return;
	}

	appendRow(list, "Capacity", formatNumber(capacity), { title: breakdown.join(" + ") });
	for (const entry of bestItems) {
		appendRow(list, `${entry.country.name}`, `${entry.item.name}: ${formatNumber(entry.profitPerMinute, { currency: true, forceOperation: true })}/min`, {
			className: entry.profitPerMinute >= 0 ? "tt-home-card-row-positive" : "tt-home-card-row-negative",
			href: `${LINKS.itemmarket}#/market/view=search&itemID=${entry.item.id}`,
			title: `Total run profit: ${formatNumber(entry.profit, { currency: true, forceOperation: true })}`,
		});
	}
	appendNote(list, "Uses API market prices and vendor buy prices; current abroad stock is not checked.");
}

async function showCrimeProgress() {
	const list = await createCardList(CARD_IDS.crimeProgress, "Crime Progress", {
		defaultColumnId: "column1",
		defaultAfterTitle: "Personal Information",
		contentClass: "tt-crime-progress-card",
	});
	const crimes = userdata.personalstats?.crimes as AnyRecord | undefined;
	if (!crimes) {
		appendNote(list, "Crime personal stats are not available yet.");
		return;
	}

	const totals = getCrimeTotals(crimes);
	appendRow(list, "Crime version", crimes.version === "v2" ? "Crimes 2.0" : "Crimes 1.0", { href: LINKS.crimes });
	appendRow(list, "Total offenses", formatNumber(totals.total), { href: LINKS.crimes });
	appendRow(list, "Organized crimes", formatNumber(totals.organizedCrimes), { href: LINKS.organizedCrimes });
	if (totals.bestSkill)
		appendRow(list, "Best crime skill", `${formatSkillName(totals.bestSkill.name)} (${formatNumber(totals.bestSkill.value)})`, { href: LINKS.crimes });
	if (totals.bestOffense)
		appendRow(list, "Top offense", `${formatSkillName(totals.bestOffense.name)} (${formatNumber(totals.bestOffense.value)})`, { href: LINKS.crimes });
}

async function showMarketWatchlist() {
	const list = await createCardList(CARD_IDS.marketWatchlist, "Market Watchlist", {
		defaultColumnId: "column1",
		defaultAfterTitle: "General Information",
		contentClass: "tt-market-watchlist-card",
	});
	const alerts = Object.entries(settings.notifications.types.stocks ?? {});
	const holdings = Array.isArray(userdata.stocks) ? (userdata.stocks as AnyRecord[]) : [];
	const holdingSummaries = holdings
		.map((holding) => getHoldingSummary(holding))
		.filter((holding): holding is NonNullable<typeof holding> => !!holding)
		.toSorted((a, b) => Math.abs(b.profit) - Math.abs(a.profit));

	appendRow(list, "Stock alerts", formatNumber(alerts.length), { href: LINKS.stocks });
	if (holdingSummaries.length) {
		const totalValue = holdingSummaries.reduce((total, holding) => total + holding.currentValue, 0);
		const totalProfit = holdingSummaries.reduce((total, holding) => total + holding.profit, 0);
		appendRow(list, "Portfolio value", formatNumber(totalValue, { currency: true }), { href: LINKS.stocks });
		appendRow(list, "Portfolio P/L", formatNumber(totalProfit, { currency: true, forceOperation: true }), {
			href: LINKS.stocks,
			className: totalProfit >= 0 ? "tt-home-card-row-positive" : "tt-home-card-row-negative",
		});
		const top = holdingSummaries[0];
		appendRow(list, "Biggest mover", `${top.acronym}: ${formatNumber(top.profit, { currency: true, forceOperation: true })}`, {
			href: LINKS.stocks,
			className: top.profit >= 0 ? "tt-home-card-row-positive" : "tt-home-card-row-negative",
		});
	}

	const closestAlert = getClosestStockAlert(alerts);
	if (closestAlert) {
		appendRow(list, "Closest alert", closestAlert, { href: LINKS.stocks, className: "tt-home-card-row-warning" });
	} else if (!holdingSummaries.length) {
		appendNote(list, "Add stock alerts or hold stocks to populate this card.");
	}
}

async function showTargetShortlist() {
	const list = await createCardList(CARD_IDS.targetShortlist, "Target / Enemy Shortlist", {
		defaultColumnId: "column1",
		defaultAfterTitle: "Battle Stats",
		contentClass: "tt-target-shortlist-card",
	});
	const tracked = [...(stakeouts.list ?? [])].toSorted((a, b) => a.order - b.order);
	appendRow(list, "Tracked targets", formatNumber(tracked.length), { href: browser.runtime.getURL("/targets.html") });

	const actionable = tracked.find(
		(entry) => entry.info?.status?.state === "Okay" || entry.info?.isRevivable || entry.info?.life?.current < entry.info?.life?.maximum,
	);
	if (actionable) {
		appendRow(list, "First actionable", getStakeoutLabel(actionable), {
			href: `https://www.torn.com/profiles.php?XID=${actionable.id}`,
			className: "tt-home-card-row-warning",
		});
	}

	const recentEnemy = Object.entries(attackHistory.history ?? {})
		.map(([id, info]) => ({ id, info }))
		.filter(({ info }) => !!info.lastAttack)
		.toSorted((a, b) => b.info.lastAttack - a.info.lastAttack)[0];
	if (recentEnemy) {
		appendRow(
			list,
			"Recent opponent",
			`${recentEnemy.info.name || recentEnemy.id} (${formatTime({ milliseconds: recentEnemy.info.lastAttack }, { type: "ago", short: true })})`,
			{
				href: `https://www.torn.com/profiles.php?XID=${recentEnemy.id}`,
			},
		);
	}

	if (!tracked.length && !recentEnemy) appendNote(list, "Use profile stakeouts or attack history to fill this card.");
}

async function showLoadoutQuality() {
	const list = await createCardList(CARD_IDS.loadoutQuality, "Loadout & Gear Quality", {
		defaultColumnId: "column1",
		defaultAfterTitle: "Battle Stats",
		contentClass: "tt-loadout-quality-card",
	});
	const weaponExperience = Array.isArray(userdata.weaponexp) ? (userdata.weaponexp as AnyRecord[]) : [];
	const topWeapons = weaponExperience
		.filter((weapon) => typeof weapon.name === "string" && typeof weapon.exp === "number")
		.toSorted((a, b) => b.exp - a.exp)
		.slice(0, 3);

	if (topWeapons.length) {
		appendRow(list, "Best weapon EXP", `${topWeapons[0].name} (${formatNumber(topWeapons[0].exp, { decimals: 2 })}%)`, { href: LINKS.items });
		if (topWeapons[1])
			appendRow(list, "Second weapon", `${topWeapons[1].name} (${formatNumber(topWeapons[1].exp, { decimals: 2 })}%)`, { href: LINKS.items });
		if (topWeapons[2])
			appendRow(list, "Third weapon", `${topWeapons[2].name} (${formatNumber(topWeapons[2].exp, { decimals: 2 })}%)`, { href: LINKS.items });
	} else appendNote(list, "Weapon experience API data is not available yet.");

	const ammoSummary = getAmmoSummary(userdata.ammo as AnyRecord | undefined);
	if (ammoSummary.total !== null) appendRow(list, "Ammo total", formatNumber(ammoSummary.total), { href: LINKS.items });
	if (ammoSummary.best)
		appendRow(list, "Largest ammo stack", `${formatSkillName(ammoSummary.best.name)} (${formatNumber(ammoSummary.best.value)})`, { href: LINKS.items });
}

async function createCardList(
	id: CardId,
	title: string,
	options: { defaultColumnId: "column0" | "column1"; defaultAfterTitle?: string; contentClass?: string },
) {
	const { content } = await createHomeCard({ id, title, ...options });
	const list = elementBuilder({ type: "ul", class: "info-cont-wrap" });
	content.appendChild(list);

	return list;
}

function appendRow(list: HTMLElement, label: string, value: string | number | Node, options: RowOptions = {}) {
	const attributes = options.title ? { title: options.title } : undefined;
	const valueElement = buildRowValueElement(value, options.href, attributes);
	list.appendChild(
		elementBuilder({
			type: "li",
			class: options.className,
			children: [
				elementBuilder({ type: "div", class: "divider", children: [elementBuilder({ type: "span", text: label })] }),
				elementBuilder({ type: "div", class: "desc", children: [valueElement] }),
			],
		}),
	);
}

function buildRowValueElement(value: string | number | Node, href?: string, attributes?: Record<string, string>) {
	const content = value instanceof Node ? { children: [value] } : { text: value };
	if (href) return elementBuilder({ type: "a", class: "tt-home-card-link tt-home-card-value", href, attributes, ...content });

	return elementBuilder({ type: "span", class: "tt-home-card-value", attributes, ...content });
}

function appendNote(list: HTMLElement, text: string) {
	list.appendChild(elementBuilder({ type: "li", class: "tt-home-card-row-note", text }));
}

function appendGrowthRow(list: HTMLElement, label: string, value: number | null) {
	appendRow(list, label, value === null ? "Need history" : formatNumber(value, { forceOperation: true }), {
		className: value === null ? "tt-home-card-row-muted" : value >= 0 ? "tt-home-card-row-positive" : "tt-home-card-row-negative",
	});
}

function appendChecklistRow(list: HTMLElement, label: string, done: boolean, value: string, href?: string) {
	appendRow(list, label, `${done ? "✓" : "!"} ${value}`, { href, className: done ? "tt-home-card-row-done" : "tt-home-card-row-pending" });
}

function getBattleStatsSnapshot(): BattleStatsSnapshot | null {
	return getBattleStatsSnapshotFromHome() ?? getBattleStatsSnapshotFromApi();
}

function getBattleStatsSnapshotFromHome(): BattleStatsSnapshot | null {
	const statsContainer = findHomePanelByTitle("Battle Stats")?.querySelector<HTMLElement>("ul.info-cont-wrap");
	if (!statsContainer) return null;

	const snapshot = {
		timestamp: Date.now(),
		total: getHomeBattleStatValue(statsContainer, "Total") ?? 0,
		strength: getHomeBattleStatValue(statsContainer, "Strength") ?? 0,
		defense: getHomeBattleStatValue(statsContainer, "Defense") ?? 0,
		speed: getHomeBattleStatValue(statsContainer, "Speed") ?? 0,
		dexterity: getHomeBattleStatValue(statsContainer, "Dexterity") ?? 0,
	};
	if (!snapshot.total) snapshot.total = STAT_KEYS.reduce((total, key) => total + snapshot[key], 0);

	return snapshot.total ? snapshot : null;
}

function getHomeBattleStatValue(statsContainer: HTMLElement, label: string) {
	const row = Array.from(statsContainer.querySelectorAll<HTMLElement>(":scope > li")).find(
		(row) => row.querySelector(".divider .label, .divider span")?.textContent?.trim() === label,
	);

	return getNumber(row?.querySelector(".desc")?.textContent);
}

function getBattleStatsSnapshotFromApi(): BattleStatsSnapshot | null {
	const stats = userdata.battlestats;
	if (!stats) return null;

	const snapshot = {
		timestamp: getNumber(userdata.dateBasic) ?? getNumber(userdata.date) ?? Date.now(),
		total: getNumber(stats.total) ?? 0,
		strength: getNumber(stats.strength?.value) ?? 0,
		defense: getNumber(stats.defense?.value) ?? 0,
		speed: getNumber(stats.speed?.value) ?? 0,
		dexterity: getNumber(stats.dexterity?.value) ?? 0,
	};
	if (!snapshot.total) snapshot.total = STAT_KEYS.reduce((total, key) => total + snapshot[key], 0);

	return snapshot.total ? snapshot : null;
}

function getBattleStatsHistory(): BattleStatsSnapshot[] {
	return (((localdata.homeCards ?? {}) as HomeCardsLocaldata).battleStatsHistory ?? [])
		.filter(isBattleStatsSnapshot)
		.toSorted((a, b) => a.timestamp - b.timestamp);
}

async function recordBattleStatsSnapshot(current: BattleStatsSnapshot, history: BattleStatsSnapshot[]) {
	const compactedHistory = compactBattleStatsHistory(history, current.timestamp);
	const latest = compactedHistory.at(-1);
	if (latest?.total === current.total) {
		if (compactedHistory.length !== history.length) await saveBattleStatsHistory(compactedHistory);
		return;
	}

	await saveBattleStatsHistory(compactBattleStatsHistory([...compactedHistory, current], current.timestamp));
}

function compactBattleStatsHistory(history: BattleStatsSnapshot[], currentTimestamp: number) {
	return history
		.filter((snapshot) => currentTimestamp - snapshot.timestamp <= HISTORY_KEEP_FOR)
		.reduce<BattleStatsSnapshot[]>((kept, snapshot) => {
			const latest = kept.at(-1);
			if (!latest || latest.total !== snapshot.total) kept.push(snapshot);

			return kept;
		}, [])
		.slice(-HOME_CARD_HISTORY_LIMIT);
}

async function saveBattleStatsHistory(battleStatsHistory: BattleStatsSnapshot[]) {
	await ttStorage.change({ localdata: { homeCards: { battleStatsHistory } } });
}

function isBattleStatsSnapshot(value: unknown): value is BattleStatsSnapshot {
	const record = asRecord(value);
	return !!record && ["timestamp", "total", ...STAT_KEYS].every((key) => typeof record[key] === "number" && Number.isFinite(record[key]));
}

function getTodaysBaselineSnapshot(history: BattleStatsSnapshot[], timestamp: number) {
	const tornDayStart = getTornDayStart(timestamp);
	const sameDaySnapshots = history.filter((snapshot) => snapshot.timestamp >= tornDayStart && snapshot.timestamp < timestamp);
	const previousSnapshot = history.filter((snapshot) => snapshot.timestamp < tornDayStart && snapshot.timestamp >= tornDayStart - TO_MILLIS.DAYS).at(-1);
	const candidates = [...sameDaySnapshots, previousSnapshot].filter(Boolean) as BattleStatsSnapshot[];

	return candidates.toSorted((a, b) => a.total - b.total || a.timestamp - b.timestamp)[0] ?? null;
}

function getBattleStatsGrowthNote(todayBaseline: BattleStatsSnapshot | null, timestamp: number) {
	if (!todayBaseline) return "Baseline saved; growth appears after your battle stats change.";

	const baselineTime = formatTime({ milliseconds: todayBaseline.timestamp }, { type: "ago", short: true });
	if (!isSameTornDay(todayBaseline.timestamp, timestamp)) return `Today uses the latest saved baseline before Torn midnight (${baselineTime}).`;

	return `Today baseline saved ${baselineTime}; snapshots are saved when your total changes.`;
}

function isSameTornDay(first: number, second: number) {
	return getTornDayStart(first) === getTornDayStart(second);
}

function getTornDayStart(timestamp: number) {
	const date = new Date(timestamp);
	date.setUTCHours(0, 0, 0, 0);

	return date.getTime();
}

function getSnapshotBefore(history: BattleStatsSnapshot[], timestamp: number) {
	return history.filter((snapshot) => snapshot.timestamp <= timestamp).at(-1) ?? null;
}

function createRelativeCountdownValue(seconds: number | null, doneText = "Ready") {
	const end = getRelativeEndTime(seconds);
	return end ? createCountdownValue(end, doneText) : doneText;
}

function getRelativeEndTime(seconds: number | null) {
	if (!seconds || seconds <= 0) return null;
	const base = getNumber(userdata.timestamp) ? userdata.timestamp * TO_MILLIS.SECONDS : (getNumber(userdata.date) ?? Date.now());

	return base + seconds * TO_MILLIS.SECONDS;
}

function createAbsoluteCountdownValue(end: number, doneText = "Ready") {
	return end > Date.now() ? createCountdownValue(end, doneText) : doneText;
}

function createCountdownValue(end: number, doneText: string) {
	const timeSettings = { type: "timer", daysToHours: true } as const;
	const milliseconds = Math.max(end - Date.now(), 0);
	const timer = elementBuilder({
		type: "span",
		class: "tt-home-card-value-countdown",
		text: milliseconds ? formatTime({ milliseconds }, timeSettings) : doneText,
		dataset: { end, doneText, timeSettings },
	});
	if (milliseconds) countdownTimers.push(timer);

	return timer;
}

function formatRelativeSeconds(seconds: number | null) {
	const end = getRelativeEndTime(seconds);
	if (!end) return "Ready";
	const milliseconds = Math.max(end - Date.now(), 0);

	return milliseconds ? formatTime({ milliseconds }, { type: "timer", daysToHours: true }) : "Ready";
}

function isBarBelowMaximum(bar: unknown) {
	const record = asRecord(bar);
	const current = getNumber(record?.current);
	const maximum = getNumber(record?.maximum);
	if (current === null || maximum === null) return false;

	return current < maximum;
}

function getBarText(bar: unknown) {
	const record = asRecord(bar);
	const current = getNumber(record?.current);
	const maximum = getNumber(record?.maximum);
	if (current === null || maximum === null) return "No data";

	return `${formatNumber(current)} / ${formatNumber(maximum)}`;
}

function getMissionCount() {
	const missions = asRecord(userdata.missions);
	if (!missions) return null;

	const givers = Array.isArray(missions.givers) ? missions.givers : [];
	return givers
		.flatMap((giver) => (Array.isArray(giver.contracts) ? giver.contracts : []))
		.filter((contract) => ["Accepted", "Available"].includes(contract.status)).length;
}

function getPrimaryRankedWar() {
	const rankedWars = Array.isArray((factiondata as AnyRecord).rankedwars) ? ((factiondata as AnyRecord).rankedwars as AnyRecord[]) : [];
	const war = rankedWars[0];
	if (!war) return null;

	const start = getNumber(war.start);
	const end = getNumber(war.end);
	if (!start) return "Planned";
	if (end && end > 0) return "Recently ended";

	const startsAt = start * TO_MILLIS.SECONDS;
	return startsAt > Date.now() ? `Starts in ${formatTime({ milliseconds: startsAt - Date.now() }, { type: "timer", daysToHours: true })}` : "Ongoing";
}

function getWarSummary() {
	const wars = asRecord((factiondata as AnyRecord).wars);
	if (wars) {
		const raids = Array.isArray(wars.raids) ? wars.raids.length : 0;
		const territory = Array.isArray(wars.territory) ? wars.territory.length : 0;
		if (raids || territory) return [`${raids} raid`, `${territory} territory`].join(" / ");

		return "None";
	}

	const currentFactionStakeout = factionStakeouts.list?.find((entry) => entry.id === userdata.faction?.id);
	if (currentFactionStakeout?.info?.raid || currentFactionStakeout?.info?.territoryWar) {
		return `${currentFactionStakeout.info.raid ? "Raid" : "No raid"} / ${currentFactionStakeout.info.territoryWar ? "Territory war" : "No territory"}`;
	}

	return "Not cached";
}

function appendOrganizedCrimeRows(list: HTMLElement) {
	const crime = asRecord((userdata as AnyRecord).organizedCrime);
	if (!crime || "error" in crime || "code" in crime || !["Recruiting", "Planning"].includes(crime.status)) return false;

	const slot = getOwnOrganizedCrimeSlot(crime);
	const name = typeof crime.name === "string" && crime.name ? crime.name : "Organized crime";
	const difficulty = getNumber(crime.difficulty);
	const position = typeof slot?.position === "string" && slot.position ? `, ${slot.position}` : "";
	const time = formatOrganizedCrimeReady(crime);
	appendRow(list, "Your OC", `${name}${difficulty !== null ? ` (Lvl ${difficulty}${position})` : position}${time ? ` · ${time}` : ""}`, {
		href: LINKS.organizedCrimes,
	});

	const item = getOrganizedCrimeItemText(slot);
	appendRow(list, "OC item", item.text, { href: LINKS.organizedCrimes, className: item.className });

	return true;
}

function getOwnOrganizedCrimeSlot(crime: AnyRecord) {
	const userId = getNumber((userdata as AnyRecord).profile?.id);
	if (userId === null || !Array.isArray(crime.slots)) return null;

	return (crime.slots as AnyRecord[]).find((slot) => getNumber(slot.user?.id) === userId) ?? null;
}

function getOrganizedCrimeItemText(slot: AnyRecord | null): { text: string; className?: string } {
	if (!slot) return { text: "Slot not found", className: "tt-home-card-row-warning" };

	const requirement = asRecord(slot.item_requirement);
	if (!requirement) return { text: "No item needed" };

	const itemId = getNumber(requirement.id);
	const itemName = itemId !== null ? (ITEM_RESOLVER.loadItem(itemId)?.name ?? `Item ${itemId}`) : "Required item";
	if (requirement.is_available === false) return { text: `Need ${itemName}`, className: "tt-home-card-row-warning" };
	if (requirement.is_available === true) {
		const consumed = requirement.is_reusable === false ? " (consumed)" : "";
		return { text: `Have ${itemName}${consumed}`, className: "tt-home-card-row-positive" };
	}

	return { text: itemName };
}

function formatOrganizedCrimeReady(crime: AnyRecord) {
	const status = typeof crime.status === "string" ? crime.status : "";
	const readyAt = getOrganizedCrimeReadyAt(crime);
	if (readyAt === null) return status;

	const timeLeft = readyAt - Date.now();
	return timeLeft > 0
		? formatTime({ milliseconds: timeLeft }, { type: "wordTimer", extraShort: true, showDays: true, truncateSeconds: true })
		: `Ready ${status}`.trim();
}

function getOrganizedCrimeReadyAt(crime: AnyRecord) {
	const readyAt = getNumber(crime.ready_at);
	if (readyAt === null) return null;

	const missingMembers = Array.isArray(crime.slots) ? (crime.slots as AnyRecord[]).filter((slot) => slot.user === null).length : 0;
	const readyAtMilliseconds = readyAt * TO_MILLIS.SECONDS;
	if (!missingMembers) return readyAtMilliseconds;

	const missingTime = TO_MILLIS.DAYS * missingMembers;
	return Math.max(readyAtMilliseconds + missingTime, Date.now() + missingTime);
}

function getTravelCapacity() {
	const components = [{ label: "Base", value: 10 }];
	addTravelCapacityComponent(components, "Suitcase", sumPerkNumbers(userdata.enhancer_perks, /\+\s*(\d+)\s+Travel items/i));
	addTravelCapacityComponent(components, "Job", sumPerkNumbers(userdata.job_perks, /\+\s*(\d+).*travel.*(item|capacity)|\+\s*(\d+).*plushies.*abroad/i));
	addTravelCapacityComponent(components, "Faction", sumPerkNumbers(userdata.faction_perks, /\+\s*(\d+).*travel.*capacity/i));
	addTravelCapacityComponent(components, "Book", sumPerkNumbers(userdata.book_perks, /\+\s*(\d+).*travel (item|capacity)/i));
	addTravelCapacityComponent(components, "PI / travel method", getTravelMethodCapacityBonus());

	return {
		capacity: components.reduce((total, component) => total + component.value, 0),
		breakdown: components.map((component) => `${component.label} ${formatNumber(component.value, { forceOperation: component.value > 0 })}`),
	};
}

function addTravelCapacityComponent(components: { label: string; value: number }[], label: string, value: number) {
	if (value > 0) components.push({ label, value });
}

function getTravelMethodCapacityBonus() {
	const method = (userdata as AnyRecord).travel?.method;
	if (typeof method === "string" && method.toLowerCase() !== "standard") return 5;
	if (hasCurrentPropertyAirstrip()) return 5;

	return 0;
}

function hasCurrentPropertyAirstrip() {
	const propertyPerks = (userdata as AnyRecord).property_perks;
	if (Array.isArray(propertyPerks) && propertyPerks.some((perk) => typeof perk === "string" && /airstrip|private island|travel.*(item|capacity)/i.test(perk)))
		return true;

	const properties = (userdata as AnyRecord).properties;
	if (!Array.isArray(properties)) return false;

	const userId = getNumber((userdata as AnyRecord).profile?.id);
	return properties.some((property) => {
		const record = asRecord(property);
		const propertyName = String(record?.property?.name ?? "");
		const hasAirstrip = Array.isArray(record?.modifications) && record.modifications.includes("Airstrip");
		const usedByUser = Array.isArray(record?.used_by) && userId !== null && record.used_by.some((user) => getNumber(user?.id) === userId);
		const inUse = record?.status === "in_use" || usedByUser;

		return inUse && hasAirstrip && propertyName === "Private Island";
	});
}

function sumPerkNumbers(perks: unknown, regex: RegExp) {
	if (!Array.isArray(perks)) return 0;

	return perks
		.map((perk) => (typeof perk === "string" ? perk.match(regex) : null))
		.filter((match): match is RegExpMatchArray => !!match)
		.map((match) => getNumber(match[1] ?? match[2] ?? match[3]) ?? 0)
		.reduce((total, value) => total + value, 0);
}

function getCrimeTotals(crimes: AnyRecord) {
	if (crimes.version === "v2") {
		const offenses = asRecord(crimes.offenses) ?? {};
		const skills = asRecord(crimes.skills) ?? {};

		return {
			total: getNumber(offenses.total) ?? 0,
			organizedCrimes: getNumber(offenses.organized_crimes) ?? 0,
			bestSkill: getLargestEntry(skills),
			bestOffense: getLargestEntry({ ...offenses, total: undefined, organized_crimes: undefined }),
		};
	}

	return {
		total: getNumber(crimes.total) ?? 0,
		organizedCrimes: getNumber(crimes.organized_crimes) ?? 0,
		bestSkill: null,
		bestOffense: getLargestEntry({ ...crimes, total: undefined, version: undefined, organized_crimes: undefined }),
	};
}

function getLargestEntry(record: AnyRecord) {
	return Object.entries(record)
		.map(([name, value]) => ({ name, value: getNumber(value) }))
		.filter((entry): entry is { name: string; value: number } => entry.value !== null)
		.toSorted((a, b) => b.value - a.value)[0];
}

function getHoldingSummary(holding: AnyRecord) {
	const id = getNumber(holding.id);
	const shares = getNumber(holding.shares);
	if (id === null || shares === null) return null;

	const stock = getStockEntry(id);
	if (!stock) return null;

	const currentValue = stock.current_price * shares;
	const boughtValue = Array.isArray(holding.transactions)
		? holding.transactions.reduce((total, transaction) => total + (getNumber(transaction.shares) ?? 0) * (getNumber(transaction.price) ?? 0), 0)
		: 0;

	return {
		acronym: stock.acronym ?? stock.name ?? String(id),
		currentValue,
		profit: boughtValue ? currentValue - boughtValue : 0,
	};
}

function getClosestStockAlert(alerts: [string, { priceFalls: number; priceReaches: number }][]) {
	return alerts
		.flatMap(([id, alert]) => {
			const stock = getStockEntry(id);
			if (!stock) return [];

			return [
				alert.priceFalls
					? {
							stock,
							text: `${stock.acronym} falls to ${formatNumber(alert.priceFalls, { currency: true })}`,
							distance: Math.abs(stock.current_price - alert.priceFalls),
						}
					: null,
				alert.priceReaches
					? {
							stock,
							text: `${stock.acronym} reaches ${formatNumber(alert.priceReaches, { currency: true })}`,
							distance: Math.abs(stock.current_price - alert.priceReaches),
						}
					: null,
			].filter(Boolean);
		})
		.toSorted((a, b) => a.distance - b.distance)[0]?.text;
}

function getStockEntry(id: string | number) {
	const value = (stockdata as AnyRecord)[id];
	if (!value || typeof value === "number") return null;

	return value as { acronym: string; name: string; current_price: number };
}

function getStakeoutLabel(entry: NonNullable<(typeof stakeouts.list)[number]>) {
	const name = entry.info?.name || entry.label || String(entry.id);
	const status = entry.info?.status?.description || entry.info?.status?.state;
	return status ? `${name}: ${status}` : name;
}

function getAmmoSummary(ammo: AnyRecord | undefined) {
	if (!ammo) return { total: null, best: null };

	const entries = flattenNumericEntries(ammo).filter((entry) => !entry.name.toLowerCase().includes("id"));
	if (!entries.length) return { total: null, best: null };

	return {
		total: entries.reduce((total, entry) => total + entry.value, 0),
		best: entries.toSorted((a, b) => b.value - a.value)[0],
	};
}

function flattenNumericEntries(value: unknown, prefix = ""): { name: string; value: number }[] {
	const record = asRecord(value);
	if (!record) return [];

	return Object.entries(record).flatMap(([key, child]) => {
		const name = prefix ? `${prefix} ${key}` : key;
		const numeric = getNumber(child);
		if (numeric !== null) return [{ name, value: numeric }];

		return flattenNumericEntries(child, name);
	});
}

function formatSkillName(name: string) {
	return name.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function capitalizeStat(stat: StatKey) {
	return stat.charAt(0).toUpperCase() + stat.slice(1);
}

function getNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const number = convertToNumber(value);
		return Number.isFinite(number) ? number : null;
	}

	return null;
}

function asRecord(value: unknown): AnyRecord | null {
	return value && typeof value === "object" ? (value as AnyRecord) : null;
}

export default class AdditionalHomeCardsFeature extends Feature {
	constructor() {
		super("Additional Home Cards", "home");
	}

	precondition() {
		return getPageStatus().access && !isFlying() && !isAbroad();
	}

	requirements() {
		if (!hasAPIData()) return "No API access.";

		return true;
	}

	isEnabled() {
		return settings.pages.home.additionalCards;
	}

	async execute() {
		await showAdditionalHomeCards();
	}

	cleanup() {
		removeAdditionalHomeCardTimers();
		Object.values(CARD_IDS).forEach(removeHomeCard);
	}

	storageKeys() {
		return [
			"settings.pages.home.additionalCards",
			"userdata.battlestats",
			"userdata.cooldowns",
			"userdata.energy",
			"userdata.nerve",
			"userdata.happy",
			"userdata.refills",
			"userdata.missions",
			"userdata.faction",
			"userdata.organizedCrime",
			"userdata.userCrime",
			"userdata.travel",
			"userdata.enhancer_perks",
			"userdata.job_perks",
			"userdata.faction_perks",
			"userdata.book_perks",
			"userdata.property_perks",
			"userdata.properties",
			"userdata.personalstats",
			"userdata.weaponexp",
			"userdata.ammo",
			"userdata.stocks",
			"factiondata",
			"factionStakeouts",
			"stakeouts",
			"attackHistory",
			"stockdata",
			"settings.notifications.types.stocks",
			"filters.abroadItems.taxes",
		];
	}
}
