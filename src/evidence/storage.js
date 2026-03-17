import { promises as fs } from "node:fs";
import path from "node:path";

const UPLOAD_ROOT = path.resolve(process.cwd(), "data", "evidence_uploads");
const MIME_EXTENSION = Object.freeze({
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/heic": ".heic",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
});

function sanitizeSegment(value, fallback = "file") {
  const normalized = String(value ?? "").trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeMimeType(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.length > 0 ? normalized : "application/octet-stream";
}

function inferExtension(fileName, mimeType) {
  const rawExt = path.extname(String(fileName ?? "")).trim().toLowerCase();
  if (rawExt) {
    return rawExt;
  }
  return MIME_EXTENSION[normalizeMimeType(mimeType)] ?? "";
}

function resolveStoragePath(storageKey) {
  const safeParts = String(storageKey)
    .split("/")
    .filter(Boolean)
    .map((item) => sanitizeSegment(item));
  return path.join(UPLOAD_ROOT, ...safeParts);
}

export async function storeEvidenceBinary(evidence, buffer, options = {}) {
  const mimeType = normalizeMimeType(options.mimeType ?? evidence.mimeType);
  const requestedName = String(options.fileName ?? evidence.fileName ?? `${evidence.evidenceId}`);
  const extension = inferExtension(requestedName, mimeType);
  const fileName = `${sanitizeSegment(path.basename(requestedName, path.extname(requestedName)), evidence.evidenceId)}${extension}`;
  const storageKey = `evidence/${sanitizeSegment(evidence.roomId, "room")}/${sanitizeSegment(evidence.evidenceId, "evidence")}${extension}`;
  const outputPath = resolveStoragePath(storageKey);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buffer);

  return {
    storageKey,
    fileName,
    mimeType,
    sizeBytes: buffer.byteLength,
    viewUrl: `/uploads/${encodeURIComponent(evidence.evidenceId)}`,
  };
}

export async function readEvidenceBinary(storageKey) {
  const filePath = resolveStoragePath(storageKey);
  const buffer = await fs.readFile(filePath);
  return {
    buffer,
    filePath,
  };
}
