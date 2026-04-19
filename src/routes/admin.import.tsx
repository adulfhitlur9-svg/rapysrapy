import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { bulkImport, getStats, verifyAdminToken } from "@/server/users.functions";
import type { WorkerOutMsg } from "@/workers/jsonStreamParser.worker";

export const Route = createFileRoute("/admin/import")({
  head: () => ({
    meta: [
      { title: "Import archivo.json — userlookup" },
      { name: "description", content: "Jednorazowy import archivo.json do bazy (tylko admin)." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  loader: () => getStats(),
  component: ImportPage,
});

const BATCH_SIZE = 1000;
const TOKEN_KEY = "admin_import_token";

export function ImportPage() {
  const initial = Route.useLoaderData();
  const [total, setTotal] = useState(initial.total);
  const [token, setToken] = useState<string>("");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({
    parsed: 0,
    inserted: 0,
    skipped: 0,
    bytesRead: 0,
    totalBytes: 0,
    bufferKB: 0,
    batchNum: 0,
    queuedBatches: 0,
    elapsedMs: 0,
    lastBatchMs: 0,
  });
  const [phase, setPhase] = useState<string>("Bezczynne");
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const cancelRef = useRef(false);

  const append = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLog((l) => [...l.slice(-200), `[${ts}] ${msg}`]);
  };

  useEffect(() => {
    const saved = typeof window !== "undefined" ? sessionStorage.getItem(TOKEN_KEY) : null;
    if (saved) {
      setToken(saved);
      verifyAdminToken({ data: { token: saved } })
        .then((r) => {
          if (r.ok) setAuthed(true);
          else sessionStorage.removeItem(TOKEN_KEY);
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!busy && authed) {
      getStats().then((s) => setTotal(s.total)).catch(() => {});
    }
  }, [busy, authed]);

  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError(null);
    try {
      const r = await verifyAdminToken({ data: { token } });
      if (r.ok) {
        sessionStorage.setItem(TOKEN_KEY, token);
        setAuthed(true);
      } else {
        setAuthError(r.error || "Nieprawidłowy token");
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Błąd weryfikacji");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
    setAuthed(false);
  };

  const handleCancel = () => {
    cancelRef.current = true;
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    append("⏹ Anulowano przez użytkownika");
    setBusy(false);
    setPhase("Anulowano");
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setLog([]);
    cancelRef.current = false;
    const startedAt = performance.now();
    setProgress({
      parsed: 0,
      inserted: 0,
      skipped: 0,
      bytesRead: 0,
      totalBytes: file.size,
      bufferKB: 0,
      batchNum: 0,
      queuedBatches: 0,
      elapsedMs: 0,
      lastBatchMs: 0,
    });
    setPhase("Uruchamiam worker…");
    append(`📂 ${file.name} — ${(file.size / 1024 / 1024).toFixed(1)} MB`);
    append(`▶ Worker startuje, batch = ${BATCH_SIZE}`);

    // Kolejka batchy + sekwencyjny consumer
    const queue: unknown[][] = [];
    let processing = false;
    let totalInserted = 0;
    let totalSkipped = 0;
    let batchNum = 0;
    let workerDone = false;

    const updateElapsed = () => {
      setProgress((p) => ({ ...p, elapsedMs: performance.now() - startedAt }));
    };
    const ticker = window.setInterval(updateElapsed, 500);

    const processQueue = async () => {
      if (processing) return;
      processing = true;
      while (queue.length > 0 && !cancelRef.current) {
        const records = queue.shift()!;
        batchNum++;
        const t0 = performance.now();
        setPhase(`Wysyłam batch #${batchNum} (${records.length})…`);
        append(`⇪ Batch #${batchNum}: wysyłam ${records.length.toLocaleString()} rekordów…`);
        try {
          const res = await bulkImport({ data: { token, records } });
          const dt = performance.now() - t0;
          if (res.error) append(`⚠ ${res.error}`);
          totalInserted += res.inserted;
          totalSkipped += res.skipped;
          setProgress((p) => ({
            ...p,
            inserted: totalInserted,
            skipped: totalSkipped + p.skipped - p.skipped, // keep parser-skipped value untouched
            batchNum,
            queuedBatches: queue.length,
            lastBatchMs: dt,
            elapsedMs: performance.now() - startedAt,
          }));
          append(
            `✓ Batch #${batchNum} OK w ${(dt / 1000).toFixed(1)}s — wstawione +${res.inserted}, duplikaty +${res.skipped}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          append(`✗ Batch #${batchNum} błąd: ${msg}`);
        }
      }
      processing = false;
      if (workerDone && queue.length === 0 && !cancelRef.current) {
        const total = (performance.now() - startedAt) / 1000;
        setPhase("Zakończono");
        append(
          `🎉 Gotowe w ${total.toFixed(1)}s · wstawione ${totalInserted.toLocaleString()} · duplikaty ${totalSkipped.toLocaleString()} · batchy ${batchNum}`,
        );
        window.clearInterval(ticker);
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    };

    const worker = new Worker(
      new URL("@/workers/jsonStreamParser.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        setProgress((p) => ({
          ...p,
          bytesRead: msg.bytesRead,
          totalBytes: msg.totalBytes,
          parsed: msg.parsed,
          bufferKB: msg.bufferKB,
          queuedBatches: queue.length,
        }));
        setPhase(processing ? `Czytam + wysyłam batch #${batchNum}` : "Czytam plik…");
      } else if (msg.type === "log") {
        append(msg.message);
      } else if (msg.type === "batch") {
        queue.push(msg.records);
        setProgress((p) => ({
          ...p,
          parsed: msg.parsed,
          skipped: msg.skipped,
          queuedBatches: queue.length,
        }));
        void processQueue();
      } else if (msg.type === "done") {
        workerDone = true;
        append(`◼ Parser zakończył. Pozostało batchy w kolejce: ${queue.length}`);
        setProgress((p) => ({ ...p, parsed: msg.parsed, skipped: msg.skipped }));
        void processQueue();
      } else if (msg.type === "error") {
        setError(msg.message);
        append(`✗ Worker error: ${msg.message}`);
        workerDone = true;
        window.clearInterval(ticker);
        setBusy(false);
        setPhase("Błąd");
      }
    };

    worker.onerror = (ev) => {
      setError(ev.message);
      append(`✗ Worker crash: ${ev.message}`);
      workerDone = true;
      window.clearInterval(ticker);
      setBusy(false);
      setPhase("Błąd");
    };

    worker.postMessage({ type: "start", file, batchSize: BATCH_SIZE });
    setPhase("Czytam plik…");
  };

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <form
          onSubmit={handleLogin}
          className="w-full max-w-sm rounded-2xl border border-border bg-card p-8"
        >
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
            ← powrót
          </Link>
          <h1 className="text-2xl font-bold mt-3 mb-1">Admin · import</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Strefa zastrzeżona. Podaj token administratora.
          </p>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            placeholder="Token admina"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-border bg-background font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {authError && <div className="mt-3 text-sm text-destructive">{authError}</div>}
          <button
            type="submit"
            disabled={authBusy || !token}
            className="mt-4 w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50 hover:opacity-90 transition"
          >
            {authBusy ? "Sprawdzam…" : "Wejdź"}
          </button>
        </form>
      </div>
    );
  }

  const readPct = progress.totalBytes > 0 ? (progress.bytesRead / progress.totalBytes) * 100 : 0;
  const elapsedSec = progress.elapsedMs / 1000;
  const mbRead = progress.bytesRead / 1024 / 1024;
  const speed = elapsedSec > 0 ? mbRead / elapsedSec : 0;
  const recPerSec = elapsedSec > 0 ? progress.inserted / elapsedSec : 0;
  const etaSec =
    speed > 0 && progress.totalBytes > progress.bytesRead
      ? (progress.totalBytes - progress.bytesRead) / 1024 / 1024 / speed
      : 0;
  const fmtTime = (s: number) => {
    if (!isFinite(s) || s <= 0) return "—";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← powrót
          </Link>
          <button
            onClick={handleLogout}
            className="text-xs text-muted-foreground hover:text-destructive"
          >
            wyloguj
          </button>
        </div>
        <h1 className="text-3xl font-bold mt-4 mb-2">Import archivo.json</h1>
        <p className="text-muted-foreground mb-8">
          Parser działa w <strong>Web Workerze</strong> — UI nie blokuje się nawet przy plikach
          400+ MB. Batche po {BATCH_SIZE}.
        </p>

        <div className="rounded-2xl border border-border bg-card p-6 mb-6">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Rekordów w bazie
            </span>
            <span className="text-3xl font-bold font-mono">{total.toLocaleString()}</span>
          </div>
        </div>

        <label
          className={`block rounded-2xl border-2 border-dashed border-border bg-card/50 p-10 text-center cursor-pointer hover:border-primary transition ${
            busy ? "opacity-50 pointer-events-none" : ""
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <div className="text-4xl mb-2">⤓</div>
          <div className="font-semibold">Kliknij aby wybrać archivo.json</div>
          <div className="text-xs text-muted-foreground mt-1">
            Obsługa dużych plików (setki MB) — parser w Web Workerze
          </div>
        </label>

        {(busy || progress.parsed > 0 || progress.bytesRead > 0) && (
          <div className="rounded-2xl border border-border bg-card p-6 mt-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Status
                </div>
                <div className="font-semibold">{phase}</div>
              </div>
              {busy && (
                <button
                  onClick={handleCancel}
                  className="px-3 py-1.5 rounded-lg border border-destructive/40 text-destructive text-xs hover:bg-destructive/10"
                >
                  Anuluj
                </button>
              )}
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">Odczyt pliku</span>
                <span className="font-mono">
                  {mbRead.toFixed(1)} / {(progress.totalBytes / 1024 / 1024).toFixed(1)} MB (
                  {readPct.toFixed(1)}%)
                </span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-200"
                  style={{ width: `${Math.min(100, readPct)}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="rounded-lg bg-muted/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Sparsowane
                </div>
                <div className="font-mono font-bold text-lg">
                  {progress.parsed.toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg bg-muted/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Wstawione
                </div>
                <div className="font-mono font-bold text-lg">
                  {progress.inserted.toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg bg-muted/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Duplikaty
                </div>
                <div className="font-mono font-bold text-lg text-muted-foreground">
                  {progress.skipped.toLocaleString()}
                </div>
              </div>
              <div className="rounded-lg bg-muted/40 p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Batch # / kolejka
                </div>
                <div className="font-mono font-bold text-lg">
                  {progress.batchNum}
                  <span className="text-muted-foreground text-sm"> / {progress.queuedBatches}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <div className="text-muted-foreground">Czas</div>
                <div className="font-mono font-semibold">{fmtTime(elapsedSec)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Prędkość odczytu</div>
                <div className="font-mono font-semibold">{speed.toFixed(2)} MB/s</div>
              </div>
              <div>
                <div className="text-muted-foreground">Wstawiane/s</div>
                <div className="font-mono font-semibold">
                  {Math.round(recPerSec).toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">ETA odczytu</div>
                <div className="font-mono font-semibold">{busy ? fmtTime(etaSec) : "—"}</div>
              </div>
            </div>

            <div className="text-xs text-muted-foreground flex justify-between">
              <span>Bufor parsera: {progress.bufferKB.toLocaleString()} KB</span>
              {progress.lastBatchMs > 0 && (
                <span>Ostatni batch: {(progress.lastBatchMs / 1000).toFixed(2)}s</span>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 text-destructive px-4 py-3 mt-6 text-sm">
            {error}
          </div>
        )}

        {log.length > 0 && (
          <pre className="mt-6 rounded-xl border border-border bg-background/60 p-4 text-xs font-mono max-h-64 overflow-auto whitespace-pre-wrap">
            {log.join("\n")}
          </pre>
        )}
      </div>
    </div>
  );
}
