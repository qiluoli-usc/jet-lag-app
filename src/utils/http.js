export async function parseJsonBody(req) {
  const contentLength = req.headers["content-length"];
  if (contentLength !== undefined && Number(contentLength) === 0) {
    return {};
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error("Body must be valid JSON");
    err.status = 400;
    throw err;
  }
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

export function badRequest(res, status, message) {
  return sendJson(res, status, {
    error: {
      status,
      message,
    },
  });
}

export function parseIntegerParam(value, options = {}) {
  const name = String(options.name ?? "value");
  const min = Number.isFinite(Number(options.min)) ? Number(options.min) : Number.MIN_SAFE_INTEGER;
  const max = Number.isFinite(Number(options.max)) ? Number(options.max) : Number.MAX_SAFE_INTEGER;
  const fallback = options.fallback ?? null;

  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    const error = new Error(`${name} must be an integer`);
    error.status = 400;
    throw error;
  }
  if (parsed < min || parsed > max) {
    const error = new Error(`${name} must be between ${min} and ${max}`);
    error.status = 400;
    throw error;
  }
  return parsed;
}
