/**
 * 行程规划师的领域工具：全部走真实公开数据源，没有一条编造语料。
 *
 * | 工具 | 真实数据源 | 为什么行程规划需要它 |
 * | :--- | :--- | :--- |
 * | `geocode_place` | Open-Meteo Geocoding API | 地名 → 坐标 / 时区，后续查询的输入 |
 * | `weather_outlook` | Open-Meteo Forecast API | 按坐标取未来若干天的真实天气 |
 * | `currency_rate` | Frankfurter（欧洲央行参考汇率） | 出境预算换算 |
 *
 * 三个源都免密钥、稳定 JSON，因此本 Agent 不持有任何第三方凭据，
 * 也能在没有人为它准备数据的情况下给出可核验的结论。
 *
 * 边界（与协议 §5 一致）：这些工具在 **Agent 侧真实执行**，结果只回灌给
 * 上游模型；NOVA 观测到的工具调用仍然只有 `external_search` / `summarize`。
 */

import { defineTool, fetchJson } from "@chaos-design/agent-kit";

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const FX_URL = "https://api.frankfurter.app/latest";

/** 小数位统一收口：接口原始值位数过多，直接落进模型上下文是噪声 */
function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

const geocodePlace = defineTool({
  name: "geocode_place",
  description:
    "把地名解析成真实坐标、时区与国家（Open-Meteo 地理库，支持中英文地名）。规划行程的第一步：先拿到坐标，后续天气与距离才有依据。",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "地名，如「京都」「Kotor」「西安 碑林区」",
      },
      count: {
        type: "integer",
        description: "返回候选数量，取值 1 ~ 5，默认 3",
        minimum: 1,
        maximum: 5,
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (name.length === 0) {
      return {
        ok: false,
        content: "错误：name 不能为空，请给出待解析的地名。",
      };
    }

    const count = boundedInt(args.count, 3, 1, 5);
    const payload = await fetchJson(
      `${GEOCODE_URL}?name=${encodeURIComponent(name)}&count=${count}&language=zh&format=json`,
      {
        timeoutMs: ctx.timeoutMs,
        headers: { "User-Agent": "NOVA-Travel/1.0" },
      },
    );

    const hits = Array.isArray(payload?.results) ? payload.results : [];
    if (hits.length === 0) {
      return {
        ok: false,
        content: `未命中：地理库中查不到「${name}」。请改用更完整的行政区划名（如「京都府」「Kotor Montenegro」）后重试。`,
      };
    }

    const places = hits.map((hit) => ({
      name: hit.name,
      admin1: hit.admin1 ?? null,
      country: hit.country ?? null,
      countryCode: hit.country_code ?? null,
      latitude: round(hit.latitude, 4),
      longitude: round(hit.longitude, 4),
      timezone: hit.timezone ?? null,
      population: typeof hit.population === "number" ? hit.population : null,
    }));

    return {
      content: JSON.stringify({
        query: name,
        source: "open-meteo-geocoding",
        places,
      }),
      records: places.length,
    };
  },
});

const weatherOutlook = defineTool({
  name: "weather_outlook",
  description:
    "按坐标取未来若干天的真实天气预报（最高 / 最低气温、降水概率、最大风速）。行程排期与带什么衣服都靠它，禁止凭印象描述天气。",
  parameters: {
    type: "object",
    properties: {
      latitude: {
        type: "number",
        description: "纬度，来自 geocode_place 的结果",
      },
      longitude: {
        type: "number",
        description: "经度，来自 geocode_place 的结果",
      },
      days: {
        type: "integer",
        description: "预报天数，取值 1 ~ 16，默认 5",
        minimum: 1,
        maximum: 16,
      },
      timezone: {
        type: "string",
        description: 'IANA 时区（如 Asia/Tokyo），缺省用 "auto" 由坐标推断',
      },
    },
    required: ["latitude", "longitude"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const latitude = Number(args.latitude);
    const longitude = Number(args.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return {
        ok: false,
        content:
          "错误：latitude / longitude 必须是数字，请先用 geocode_place 拿到坐标。",
      };
    }
    if (
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return { ok: false, content: "错误：坐标超出合法范围。" };
    }

    const days = boundedInt(args.days, 5, 1, 16);
    const timezone =
      typeof args.timezone === "string" && args.timezone.trim().length > 0
        ? args.timezone.trim()
        : "auto";

    const query = new URLSearchParams({
      latitude: String(round(latitude, 4)),
      longitude: String(round(longitude, 4)),
      daily:
        "temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max",
      timezone,
      forecast_days: String(days),
    });

    const payload = await fetchJson(`${FORECAST_URL}?${query}`, {
      timeoutMs: ctx.timeoutMs,
      headers: { "User-Agent": "NOVA-Travel/1.0" },
    });

    const daily = payload?.daily;
    const dates = Array.isArray(daily?.time) ? daily.time : [];
    if (dates.length === 0) {
      return { ok: false, content: "错误：预报接口没有返回任何日期数据。" };
    }

    const forecasts = dates.map((date, index) => ({
      date,
      highC: daily.temperature_2m_max?.[index] ?? null,
      lowC: daily.temperature_2m_min?.[index] ?? null,
      rainChance:
        typeof daily.precipitation_probability_max?.[index] === "number"
          ? daily.precipitation_probability_max[index]
          : null,
      maxWindKmh:
        typeof daily.wind_speed_10m_max?.[index] === "number"
          ? round(daily.wind_speed_10m_max[index], 1)
          : null,
    }));

    return {
      content: JSON.stringify({
        source: "open-meteo-forecast",
        resolvedTimezone: payload?.timezone ?? timezone,
        forecasts,
      }),
      records: forecasts.length,
    };
  },
});

const currencyRate = defineTool({
  name: "currency_rate",
  description:
    "查真实汇率（欧洲央行参考汇率，工作日更新）并换算金额，用于出境行程的预算估算。",
  parameters: {
    type: "object",
    properties: {
      from: { type: "string", description: "源货币三位代码，如 CNY" },
      to: { type: "string", description: "目标货币三位代码，如 JPY" },
      amount: {
        type: "number",
        description: "可选：待换算金额，缺省只返回汇率",
      },
    },
    required: ["to"],
    additionalProperties: false,
  },
  async handler(args, ctx) {
    const from =
      typeof args.from === "string" && args.from.trim().length > 0
        ? args.from.trim().toUpperCase()
        : "CNY";
    const to = typeof args.to === "string" ? args.to.trim().toUpperCase() : "";

    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
      return {
        ok: false,
        content:
          "错误：货币代码必须是三位字母（如 CNY / JPY / EUR），请检查参数。",
      };
    }

    const payload = await fetchJson(`${FX_URL}?from=${from}&to=${to}`, {
      timeoutMs: ctx.timeoutMs,
      headers: { "User-Agent": "NOVA-Travel/1.0" },
    });

    const rate = payload?.rates?.[to];
    if (typeof rate !== "number") {
      return {
        ok: false,
        content: `错误：汇率源不支持 ${from} → ${to} 这个货币对。`,
      };
    }

    const amount = Number(args.amount);
    const converted = Number.isFinite(amount)
      ? { amount, converted: round(amount * rate, 2) }
      : null;

    return {
      content: JSON.stringify({
        source: "frankfurter-ecb",
        date: payload?.date ?? null,
        pair: `${from}/${to}`,
        rate: round(rate, 4),
        ...(converted ? { converted } : {}),
      }),
      records: 1,
    };
  },
});

/** 挂到 agent-kit 工具层的清单（顺序即上游看到工具的顺序） */
export const travelTools = [geocodePlace, weatherOutlook, currencyRate];
