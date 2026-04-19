/// <reference lib="webworker" />
import { extractImportRecords, normalizeImportRecord } from "@/lib/import-records";

// Web Worker: strumieniowo parsuje duży JSON i wysyła batche gotowych rekordów.

export type WorkerInMsg = { type: "start"; file: File; batchSize: number };
export type WorkerOutMsg =
  | { type: "progress"; bytesRead: number; totalBytes: number; parsed: number; bufferKB: number }
  | { type: "batch"; records: unknown[]; parsed: number; skipped: number }
  | { type: "log"; message: string }
  | { type: "done"; parsed: number; skipped: number }
  | { type: "error"; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function isWhitespace(code: number) {
  return code === 9 || code === 10 || code === 13 || code === 32;
}

function collectRecords(value: unknown, nameHint?: string | null) {
  const direct = normalizeImportRecord(value, { nameHint });
  return direct ? [direct] : extractImportRecords(value);
}

async function run(file: File, batchSize: number) {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8");

  let buffer = "";
  let rootType: "array" | "object" | null = null;
  let depth = 0;
  let inString = false;
  let escape = false;
  let itemStart = -1;
  let keyStart = -1;
  let currentKey: string | null = null;
  let awaitingValue = false;
  let capturingKey = false;

  let batch: unknown[] = [];
  let totalParsed = 0;
  let totalSkipped = 0;
  let totalBytes = 0;
  let chunkCount = 0;
  let lastProgressAt = 0;

  const postProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < 200) return;
    lastProgressAt = now;
    ctx.postMessage({
      type: "progress",
      bytesRead: totalBytes,
      totalBytes: file.size,
      parsed: totalParsed,
      bufferKB: Math.round(buffer.length / 1024),
    } satisfies WorkerOutMsg);
  };

  const flush = () => {
    if (batch.length === 0) return;
    ctx.postMessage({
      type: "batch",
      records: batch,
      parsed: totalParsed,
      skipped: totalSkipped,
    } satisfies WorkerOutMsg);
    batch = [];
  };

  const parseCandidate = (raw: string, nameHint?: string | null) => {
    try {
      const parsed = JSON.parse(raw);
      const records = collectRecords(parsed, nameHint);
      if (records.length === 0) {
        totalSkipped++;
        return;
      }

      for (const record of records) {
        batch.push(record);
        totalParsed++;
        if (batch.length >= batchSize) flush();
      }
    } catch {
      totalSkipped++;
    }
  };

  const trimBuffer = (cutIndex: number) => {
    if (cutIndex <= 0) return;
    buffer = buffer.slice(cutIndex);
    if (itemStart >= 0) itemStart = Math.max(-1, itemStart - cutIndex);
    if (keyStart >= 0) keyStart = Math.max(-1, keyStart - cutIndex);
  };

  const consumeBuffer = () => {
    let safeCut = -1;

    for (let i = 0; i < buffer.length; i++) {
      const ch = buffer.charCodeAt(i);

      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === 92) {
          escape = true;
        } else if (ch === 34) {
          inString = false;
          if (capturingKey && keyStart >= 0) {
            try {
              currentKey = JSON.parse(buffer.slice(keyStart, i + 1));
            } catch {
              currentKey = null;
            }
            keyStart = -1;
            capturingKey = false;
          }
        }
        continue;
      }

      if (ch === 34) {
        inString = true;
        if (rootType === "object" && depth === 1 && currentKey === null && itemStart === -1 && !awaitingValue) {
          keyStart = i;
          capturingKey = true;
        }
        continue;
      }

      if (rootType === null) {
        if (isWhitespace(ch)) continue;
        if (ch === 91) {
          rootType = "array";
          depth = 1;
          safeCut = i + 1;
          continue;
        }
        if (ch === 123) {
          rootType = "object";
          depth = 1;
          safeCut = i + 1;
          continue;
        }
        throw new Error("Plik JSON musi zaczynać się od tablicy lub obiektu");
      }

      if (rootType === "object" && depth === 1 && currentKey !== null && itemStart === -1 && ch === 58) {
        awaitingValue = true;
        continue;
      }

      if (awaitingValue && depth === 1 && !isWhitespace(ch)) {
        itemStart = i;
        awaitingValue = false;
      }

      if (rootType === "array" && depth === 1 && itemStart === -1 && ch !== 44 && ch !== 93 && !isWhitespace(ch)) {
        itemStart = i;
      }

      if (ch === 123 || ch === 91) {
        depth++;
      } else if (ch === 125 || ch === 93) {
        depth--;
      }

      const arrayItemDone =
        rootType === "array" && itemStart >= 0 && ((ch === 44 && depth === 1) || (ch === 93 && depth === 0));
      const objectValueDone =
        rootType === "object" &&
        itemStart >= 0 &&
        currentKey !== null &&
        ((ch === 44 && depth === 1) || (ch === 125 && depth === 0));

      if (arrayItemDone) {
        parseCandidate(buffer.slice(itemStart, i));
        itemStart = -1;
        safeCut = i + 1;
      } else if (objectValueDone) {
        parseCandidate(buffer.slice(itemStart, i), currentKey);
        itemStart = -1;
        currentKey = null;
        awaitingValue = false;
        safeCut = i + 1;
      }
    }

    trimBuffer(safeCut);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunkCount++;
      totalBytes += value.byteLength;
      buffer += decoder.decode(value, { stream: true });

      if (chunkCount % 10 === 0) {
        const mb = (totalBytes / 1024 / 1024).toFixed(1);
        const pct = ((totalBytes / file.size) * 100).toFixed(1);
        ctx.postMessage({
          type: "log",
          message: `… przeczytano ${mb} MB (${pct}%) · bufor ${(buffer.length / 1024).toFixed(0)} KB`,
        } satisfies WorkerOutMsg);
      }

      consumeBuffer();

      postProgress();
    }

    buffer += decoder.decode();
    consumeBuffer();
    flush();
    postProgress(true);
    ctx.postMessage({ type: "done", parsed: totalParsed, skipped: totalSkipped } satisfies WorkerOutMsg);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.postMessage({ type: "error", message: msg } satisfies WorkerOutMsg);
  }
}

ctx.onmessage = (e: MessageEvent<WorkerInMsg>) => {
  const msg = e.data;
  if (msg.type === "start") {
    void run(msg.file, msg.batchSize);
  }
};
