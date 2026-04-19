/// <reference lib="webworker" />
import { extractImportRecords, normalizeImportRecord } from "@/lib/import-records";

// Web Worker: strumieniowo parsuje plik z rekordami JSON.
// Obsługiwane formaty:
//   • NDJSON / JSON Lines (każdy obiekt w osobnej linii lub oddzielony białymi znakami)
//   • strumień top-level obiektów oddzielonych przecinkami
//   • tablica obiektów [ {...}, {...} ]
//   • obiekt { "nick1": {...}, "nick2": {...} } (wartości są rekordami)

export type WorkerInMsg = { type: "start"; file: File; batchSize: number };
export type WorkerOutMsg =
  | { type: "progress"; bytesRead: number; totalBytes: number; parsed: number; bufferKB: number }
  | { type: "batch"; records: unknown[]; parsed: number; skipped: number }
  | { type: "log"; message: string }
  | { type: "done"; parsed: number; skipped: number }
  | { type: "error"; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function collectRecords(value: unknown, nameHint?: string | null) {
  const direct = normalizeImportRecord(value, { nameHint });
  return direct ? [direct] : extractImportRecords(value);
}

async function run(file: File, batchSize: number) {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8");

  let buffer = "";
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

  // Prosty skaner: szuka top-level obiektów `{ ... }` w buforze.
  // Ignoruje ewentualną otwierającą `[` oraz przecinki/białe znaki między obiektami.
  // Działa dla NDJSON, tablicy obiektów i strumienia obiektów oddzielonych przecinkami.
  const consumeBuffer = (final = false) => {
    let i = 0;
    let lastEnd = 0;
    const len = buffer.length;

    while (i < len) {
      const ch = buffer.charCodeAt(i);
      // Pomiń otwierający nawias tablicy, zamykający ], przecinki i białe znaki
      if (ch !== 123 /* { */) {
        i++;
        continue;
      }

      // Znaleziono start obiektu — szukaj pasującego `}` z uwzględnieniem stringów
      let depth = 0;
      let j = i;
      let inString = false;
      let escape = false;
      let found = -1;
      for (; j < len; j++) {
        const c = buffer.charCodeAt(j);
        if (inString) {
          if (escape) escape = false;
          else if (c === 92) escape = true;
          else if (c === 34) inString = false;
          continue;
        }
        if (c === 34) {
          inString = true;
        } else if (c === 123) {
          depth++;
        } else if (c === 125) {
          depth--;
          if (depth === 0) {
            found = j;
            break;
          }
        }
      }

      if (found === -1) {
        // Niedomknięty obiekt — czekamy na kolejny chunk
        break;
      }

      parseCandidate(buffer.slice(i, found + 1));
      i = found + 1;
      lastEnd = i;
    }

    if (final) {
      buffer = "";
    } else if (lastEnd > 0) {
      buffer = buffer.slice(lastEnd);
    } else if (buffer.length > 8 * 1024 * 1024) {
      // Bezpiecznik: jeżeli bufor urósł > 8 MB bez znalezienia `{`,
      // utnij początek (prawdopodobnie śmieci lub bardzo duży obiekt).
      buffer = buffer.slice(buffer.length - 4 * 1024 * 1024);
    }
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
    consumeBuffer(true);
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
