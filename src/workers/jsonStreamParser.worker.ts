/// <reference lib="webworker" />
// Web Worker: streamuje plik, wycina top-level obiekty JSON i wysyła batche do main thread.
// Dzięki temu główny wątek (UI) pozostaje responsywny.

export type WorkerInMsg = { type: "start"; file: File; batchSize: number };
export type WorkerOutMsg =
  | { type: "progress"; bytesRead: number; totalBytes: number; parsed: number; bufferKB: number }
  | { type: "batch"; records: unknown[]; parsed: number; skipped: number }
  | { type: "log"; message: string }
  | { type: "done"; parsed: number; skipped: number }
  | { type: "error"; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

async function run(file: File, batchSize: number) {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8");

  let buffer = "";
  let depth = 0;
  let inString = false;
  let escape = false;
  let objStart = -1;

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

      let i = 0;
      const len = buffer.length;
      while (i < len) {
        const ch = buffer.charCodeAt(i);
        if (inString) {
          if (escape) escape = false;
          else if (ch === 92 /* \ */) escape = true;
          else if (ch === 34 /* " */) inString = false;
        } else if (ch === 34) {
          inString = true;
        } else if (ch === 123 /* { */) {
          if (depth === 0) objStart = i;
          depth++;
        } else if (ch === 125 /* } */) {
          depth--;
          if (depth === 0 && objStart >= 0) {
            const slice = buffer.slice(objStart, i + 1);
            try {
              batch.push(JSON.parse(slice));
              totalParsed++;
            } catch {
              totalSkipped++;
            }
            objStart = -1;

            if (batch.length >= batchSize) {
              flush();
            }
          }
        }
        i++;
      }

      // Utnij przeskanowaną część bufora
      if (depth > 0 && objStart >= 0) {
        buffer = buffer.slice(objStart);
        objStart = 0;
      } else {
        buffer = "";
      }

      postProgress();
    }

    buffer += decoder.decode();
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
