import type { AnthropicMessagesClient } from "./anthropic-provider.js";
import {
  EXTRACTION_CLOSE_TAG,
  EXTRACTION_OPEN_TAG,
  EXTRACT_TOOL,
} from "./brief-extraction.js";

const COUNTRIES: readonly [RegExp, string][] = [
  [/\b(usa|u\.s\.|united states|america)\b|\bUS\b/i, "US"],
  [/\b(uk|united kingdom|britain)\b/i, "GB"],
  [/\bgermany\b/i, "DE"],
  [/\balbania\b/i, "AL"],
  [/\bitaly\b/i, "IT"],
  [/\bfrance\b/i, "FR"],
  [/\bspain\b/i, "ES"],
];

const CHANNELS: readonly [RegExp, string][] = [
  [/\b(google|search|ppc)\b/i, "search"],
  [/\b(instagram|facebook|tiktok|social)\b/i, "social"],
  [/\b(display|banner)s?\b/i, "display"],
  [/\b(email|newsletter)\b/i, "email"],
  [/\b(youtube|video)\b/i, "video"],
];

const OBJECTIVES: readonly [RegExp, string][] = [
  [/\b(sales|sell|selling|purchases)\b/i, "sales"],
  [/\bleads?\b/i, "leads"],
  [/\b(awareness|brand)\b/i, "awareness"],
  [/\btraffic\b/i, "traffic"],
  [/\b(installs?|app downloads?)\b/i, "app_installs"],
];

const CATEGORIES = [
  "retail",
  "travel",
  "education",
  "food",
  "technology",
  "automotive",
  "finance",
  "healthcare",
  "gambling",
  "alcohol",
];

const KPIS = ["purchases", "leads", "installs", "clicks", "sessions", "impressions"];

function parseAmount(value: string, suffix: string | undefined): number {
  const base = Number(value.replace(/,/g, ""));
  return /^k$/i.test(suffix ?? "") ? base * 1000 : /^m$/i.test(suffix ?? "") ? base * 1_000_000 : base;
}

function extractFields(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const money =
    /([$€£])\s?(\d[\d,]*(?:\.\d+)?)\s?([km])?\b/i.exec(text) ??
    /(\d[\d,]*(?:\.\d+)?)\s?([km])?\s?(usd|eur|euros?|gbp|dollars?|pounds?)\b/i.exec(text);
  if (money) {
    const symbolForm = /^[$€£]$/.test(money[1] ?? "");
    const amount = symbolForm
      ? parseAmount(money[2] ?? "", money[3])
      : parseAmount(money[1] ?? "", money[2]);
    const marker = (symbolForm ? money[1] : money[3]) ?? "";
    out.budgetAmount = amount;
    if (/^\$|usd|dollar/i.test(marker)) out.currency = "USD";
    else if (/^€|eur/i.test(marker)) out.currency = "EUR";
    else if (/^£|gbp|pound/i.test(marker)) out.currency = "GBP";
  }

  const dates = text.match(/\b\d{4}-\d{2}-\d{2}\b/g);
  if (dates?.[0]) out.startDate = dates[0];
  if (dates?.[1]) out.endDate = dates[1];

  const channels = CHANNELS.filter(([pattern]) => pattern.test(text)).map(([, value]) => value);
  if (channels.length) out.channels = channels;

  const objective = OBJECTIVES.find(([pattern]) => pattern.test(text));
  if (objective) out.objective = objective[1];

  const country = COUNTRIES.find(([pattern]) => pattern.test(text));
  if (country) out.targetCountry = country[1];

  const kpi = new RegExp(`(\\d[\\d,]*)\\s+(${KPIS.join("|")})\\b`, "i").exec(text);
  if (kpi) out.targetKpi = { metric: (kpi[2] ?? "").toLowerCase(), targetValue: Number((kpi[1] ?? "").replace(/,/g, "")) };

  const name = /(?:called|named)\s+"?([^".,;\n]{3,80})"?/i.exec(text) ?? /"([^"\n]{3,80})"/.exec(text);
  if (name?.[1]) out.campaignName = name[1].trim();

  const audience = /(?:audience|targeting|aimed at)\s*[:\-]?\s*([^.;\n]{3,120})/i.exec(text);
  if (audience?.[1]) out.targetAudience = audience[1].trim();

  const category = CATEGORIES.find((item) => new RegExp(`\\b${item}\\b`, "i").test(text));
  if (category) out.category = category;

  return out;
}

/**
 * SIMULATED extractor for offline demos and tests: a handful of regex rules
 * behind the real tool_use protocol. It is NOT a language model and handles
 * only simple English phrasing and ISO dates. Never label its output as Claude.
 */
export function createSimulatedExtractorClient(): AnthropicMessagesClient {
  let counter = 0;
  return {
    messages: {
      async create(params) {
        counter += 1;
        const content = params.messages[0]?.content;
        const text = typeof content === "string" ? content : "";
        const start = text.indexOf(EXTRACTION_OPEN_TAG);
        const end = text.lastIndexOf(EXTRACTION_CLOSE_TAG);
        const body =
          start >= 0 && end > start
            ? text.slice(start + EXTRACTION_OPEN_TAG.length, end)
            : "";

        return {
          id: `msg_sim_extract_${counter}`,
          type: "message",
          role: "assistant",
          model: "simulated-extractor",
          content: [
            { type: "tool_use", id: `toolu_sim_extract_${counter}`, name: EXTRACT_TOOL, input: extractFields(body) },
          ],
          stop_reason: "tool_use",
          stop_sequence: null,
        } as never;
      },
    },
  };
}
