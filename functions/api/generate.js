const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_KEY_INFO_ENDPOINT = "https://openrouter.ai/api/v1/key";
const MODEL = "openai/gpt-5-nano";
const DAILY_SPEND_LIMIT_USD = 0.1;
const MAX_COLUMNS = 200;
const MAX_ROWS = 1000000;
const MAX_DESCRIPTION_LENGTH = 2000;

const SYSTEM_PROMPT = `You are an Excel formula generator. The user gives you ONLY the structure of their spreadsheet: column letters, headers, inferred data types, row count, target cell, and a description. You never receive their real cell values.

Generate a formula only when it can be correct from the provided structure and description. Write row-relative references for the row of targetCell. If the request is ambiguous, is not a formula request, or the available structure is insufficient, return status "unsure" and ask the single most important clarifying question. Never invent a plausible-looking formula when unsure.

For status "ok", formula must begin with =, explanation must be one plain-language sentence a non-expert can verify, and referencedRanges must list every referenced cell, column, or range. Do not use web search, tools, history, or external data.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["ok", "unsure"] },
    formula: { type: ["string", "null"] },
    explanation: { type: ["string", "null"] },
    referencedRanges: { type: "array", items: { type: "string" } },
    question: { type: ["string", "null"] },
  },
  required: ["status", "formula", "explanation", "referencedRanges", "question"],
  additionalProperties: false,
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function tokensMatch(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  let mismatch = provided.length ^ expected.length;
  const length = Math.max(provided.length, expected.length);
  for (let i = 0; i < length; i++) mismatch |= (provided.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  return mismatch === 0;
}

function hasOnlyKeys(value, allowedKeys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every(key => allowedKeys.includes(key));
}

function validatePayload(payload) {
  if (!hasOnlyKeys(payload, ["columns", "rowCount", "targetCell", "description"])) return "Request contains unsupported fields.";
  if (!Array.isArray(payload.columns) || payload.columns.length < 1 || payload.columns.length > MAX_COLUMNS) return "Invalid columns.";
  for (const column of payload.columns) {
    if (!hasOnlyKeys(column, ["col", "header", "type"])) return "Column contains unsupported fields.";
    if (!/^[A-Z]{1,3}$/.test(column.col)) return "Invalid column label.";
    if (typeof column.header !== "string" || column.header.length > 200) return "Invalid column header.";
    if (!["text", "number", "date"].includes(column.type)) return "Invalid column type.";
  }
  if (!Number.isInteger(payload.rowCount) || payload.rowCount < 1 || payload.rowCount > MAX_ROWS) return "Invalid row count.";
  if (typeof payload.targetCell !== "string" || !/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(payload.targetCell)) return "Invalid target cell.";
  if (typeof payload.description !== "string" || !payload.description.trim() || payload.description.length > MAX_DESCRIPTION_LENGTH) return "Invalid description.";
  return null;
}

function validateModelResult(result) {
  if (!hasOnlyKeys(result, ["status", "formula", "explanation", "referencedRanges", "question"])) return null;
  if (result.status === "ok") {
    if (typeof result.formula !== "string" || !result.formula.trim().startsWith("=") || result.formula.length > 2000) return null;
    if (typeof result.explanation !== "string" || !result.explanation.trim() || result.explanation.length > 2000) return null;
    if (!Array.isArray(result.referencedRanges) || result.referencedRanges.length > 100 || !result.referencedRanges.every(item => typeof item === "string" && item.length <= 100)) return null;
    return {
      status: "ok",
      formula: result.formula.trim(),
      explanation: result.explanation.trim(),
      referencedRanges: result.referencedRanges,
    };
  }
  if (result.status === "unsure" && typeof result.question === "string" && result.question.trim() && result.question.length <= 1000) {
    return { status: "unsure", question: result.question.trim() };
  }
  return null;
}

async function checkDailySpend(apiKey) {
  const response = await fetch(OPENROUTER_KEY_INFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error("Could not verify the AI spending limit.");
  const body = await response.json();
  const usage = Number(body?.data?.usage_daily);
  if (!Number.isFinite(usage)) throw new Error("Could not verify the AI spending limit.");
  return usage < DAILY_SPEND_LIMIT_USD;
}

async function requestFormula(apiKey, payload) {
  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://excel-formula-helper.pages.dev",
      "X-Title": "Excel Formula Helper",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "excel_formula_result", strict: true, schema: RESPONSE_SCHEMA },
      },
      provider: {
        require_parameters: true,
        data_collection: "deny",
        zdr: true,
      },
      max_tokens: 1000,
    }),
  });
  if (!response.ok) {
    if (response.status === 402) throw new Error("The AI spending limit has been reached for today.");
    if (response.status === 429) throw new Error("Too many requests. Please wait a minute and try again.");
    throw new Error("The AI provider is temporarily unavailable. Please try again.");
  }
  const body = await response.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;
  try {
    return validateModelResult(JSON.parse(content));
  } catch {
    return null;
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.ACCESS_TOKEN || !env.OPENROUTER_API_KEY) return jsonResponse({ error: "The AI service is not configured." }, 503);
  if (!tokensMatch(request.headers.get("X-Access-Token") || "", env.ACCESS_TOKEN)) return jsonResponse({ error: "Invalid access token." }, 403);
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > 50000) return jsonResponse({ error: "Request is too large." }, 413);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Request must be valid JSON." }, 400);
  }
  const validationError = validatePayload(payload);
  if (validationError) return jsonResponse({ error: validationError }, 400);

  try {
    if (!await checkDailySpend(env.OPENROUTER_API_KEY)) return jsonResponse({ error: "The AI spending limit has been reached for today." }, 429);
    let result = await requestFormula(env.OPENROUTER_API_KEY, payload);
    if (!result) result = await requestFormula(env.OPENROUTER_API_KEY, payload);
    if (!result) return jsonResponse({ error: "The AI returned an unsafe or invalid result. Nothing was written to your table." }, 502);
    return jsonResponse(result);
  } catch (error) {
    return jsonResponse({ error: error.message || "The AI service is temporarily unavailable." }, 502);
  }
}

export function onRequest() {
  return jsonResponse({ error: "Method not allowed." }, 405);
}
