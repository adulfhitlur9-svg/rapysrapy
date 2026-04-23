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

const BATCH_SIZE = 500;
const TOKEN_KEY = "admin_import_token";

if (import.meta.env.DEV) {
  console.info("admin.import build marker", "2026-04-19T15:58-fix2");
}

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
          if (res.error) throw new Error(res.error);
          totalInserted += res.inserted;
          totalSkipped += res.skipped;
          setProgress((p) => ({
            ...p,
            inserted: totalInserted,
            skipped: totalSkipped + p.skipped - p.skipped,
            batchNum,
            queuedBatches: queue.length,
            lastBatchMs: dt,
            elapsedMs: performance.now() - startedAt,
          }));
          append(`✓ Batch #${batchNum} OK w ${(dt / 1000).toFixed(1)}s — wstawione +${res.inserted}, duplikaty +${res.skipped}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          append(`✗ Batch #${batchNum} błąd: ${msg}`);
          setError(msg);
          setPhase("Błąd");
          cancelRef.current = true;
          if (workerRef.current) {
            workerRef.current.terminate();
            workerRef.current = null;
          }
          window.clearInterval(ticker);
          setBusy(false);
          break;
        }
      }
      processing = false;
      if (workerDone && queue.length === 0 && !cancelRef.current) {
        const total = (performance.now() - startedAt) / 1000;
        setPhase("Zakończono");
        append(`🎉 Gotowe w ${total.toFixed(1)}s · wstawione ${totalInserted.toLocaleString()} · duplikaty ${totalSkipped.toLocaleString()} · batchy ${batchNum}`);
        window.clearInterval(ticker);
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    };

    const worker = new Worker(new URL("@/workers/jsonStreamParser.worker.ts", import.meta.url), {
      type: "module",
    });
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
      <div className="min-h-screen bg-[linear-gradient(180deg,color-mix(in_oklab,var(--background)_92%,black)_0%,var(--background)_100%)] px-4 py-10">
        <div className="mx-auto flex min-h-[80vh] max-w-7xl items-center justify-center">
          <form onSubmit={handleLogin} className="w-full max-w-md rounded-2xl border border-border bg-card/65 p-8 shadow-[var(--shadow-card)]">
            <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">← powrót</Link>
            <div className="mb-6 mt-4 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
              <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-primary">restricted</span>
              <span>import / administrator</span>
            </div>
            <h1 className="mb-2 text-4xl font-bold tracking-tight">Import danych<span className="text-primary">.</span></h1>
            <p className="mb-6 text-sm leading-relaxed text-muted-foreground">Podaj token administratora, aby uruchomić import dużych plików JSON.</p>
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              placeholder="Token admina"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="h-12 w-full rounded-lg border border-border bg-input px-4 font-mono text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
            {authError && <div className="mt-3 text-sm text-destructive">{authError}</div>}
            <button
              type="submit"
              disabled={authBusy || !token}
              className="mt-4 h-12 w-full rounded-lg border border-primary/30 bg-primary px-4 font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-90 disabled:opacity-50"
            >
              {authBusy ? "Sprawdzam…" : "Wejdź"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const readPct = progress.totalBytes > 0 ? (progress.bytesRead / progress.totalBytes) * 100 : 0;
  const elapsedSec = progress.elapsedMs / 1000;
  const mbRead = progress.bytesRead / 1024 / 1024;
  const speed = elapsedSec > 0 ? mbRead / elapsedSec : 0;
  const recPerSec = elapsedSec > 0 ? progress.inserted / elapsedSec : 0;
  const etaSec = speed > 0 && progress.totalBytes > progress.bytesRead ? (progress.totalBytes - progress.bytesRead) / 1024 / 1024 / speed : 0;
  const fmtTime = (s: number) => {
    if (!isFinite(s) || s <= 0) return "—";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,color-mix(in_oklab,var(--background)_92%,black)_0%,var(--background)_100%)]">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card shadow-[var(--shadow-card)]">
              <span className="text-sm font-black text-primary">⌕</span>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight sm:text-xl">import danych</h1>
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">lookup terminal</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link to="/admin/accounts" className="rounded-md border border-border bg-card px-3 py-2 text-muted-foreground transition hover:text-foreground">Panel admina</Link>
            <Link to="/" className="rounded-md border border-border bg-card px-3 py-2 text-muted-foreground transition hover:text-foreground">Strona główna</Link>
            <button onClick={handleLogout} className="rounded-md border border-border bg-card px-3 py-2 text-muted-foreground transition hover:text-destructive">Wyloguj</button>
          </div>
        </div>
      </header>

      <main className="px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <section className="mb-6 overflow-hidden rounded-2xl border border-border bg-card/65 shadow-[var(--shadow-card)]">
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="border-b border-border/70 p-5 sm:p-8 lg:border-b-0 lg:border-r">
                <div className="mb-6 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
                  <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-primary">archivo.json</span>
                  <span>worker / batch / import</span>
                </div>
                <h2 className="mb-3 text-4xl font-bold tracking-tight sm:text-5xl">Import archivo.json<span className="text-primary">.</span></h2>
                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">Parser działa w Web Workerze, więc interfejs pozostaje responsywny nawet przy bardzo dużych plikach.</p>
              </div>
              <aside className="bg-background/55 p-5 sm:p-6">
                <div className="rounded-xl border border-border bg-card/50 p-4">
                  <div className="mb-1 text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Rekordów w bazie</div>
                  <div className="text-3xl font-bold font-mono text-primary">{total.toLocaleString()}</div>
                </div>
              </aside>
            </div>
          </section>

          <label className={`block cursor-pointer rounded-2xl border-2 border-dashed border-border bg-card/50 p-10 text-center transition hover:border-primary ${busy ? "pointer-events-none opacity-50" : ""}`}>
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
            <div className="mb-2 text-4xl">⤓</div>
            <div className="font-semibold">Kliknij aby wybrać archivo.json</div>
            <div className="mt-1 text-xs text-muted-foreground">Obsługa dużych plików, parser w Web Workerze, batch {BATCH_SIZE}</div>
          </label>

          {(busy || progress.parsed > 0 || progress.bytesRead > 0) && (
            <div className="mt-6 rounded-2xl border border-border bg-card/60 p-6 shadow-[var(--shadow-card)]">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Status</div>
                  <div className="font-semibold text-foreground">{phase}</div>
                </div>
                {busy && <button onClick={handleCancel} className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive transition hover:bg-destructive/15">Anuluj</button>}
              </div>

              <div className="mb-5">
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-muted-foreground">Odczyt pliku</span>
                  <span className="font-mono">{mbRead.toFixed(1)} / {(progress.totalBytes / 1024 / 1024).toFixed(1)} MB ({readPct.toFixed(1)}%)</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary transition-all duration-200" style={{ width: `${Math.min(100, readPct)}%` }} />
                </div>
              </div>

              <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Sparsowane" value={progress.parsed.toLocaleString()} />
                <MetricCard label="Wstawione" value={progress.inserted.toLocaleString()} accent />
                <MetricCard label="Duplikaty" value={progress.skipped.toLocaleString()} />
                <MetricCard label="Batch / kolejka" value={`${progress.batchNum} / ${progress.queuedBatches}`} />
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="Czas" value={fmtTime(elapsedSec)} small />
                <MetricCard label="Prędkość odczytu" value={`${speed.toFixed(2)} MB/s`} small />
                <MetricCard label="Wstawiane / s" value={Math.round(recPerSec).toLocaleString()} small />
                <MetricCard label="ETA odczytu" value={busy ? fmtTime(etaSec) : "—"} small />
              </div>

              <div className="mt-4 flex flex-wrap justify-between gap-3 text-xs text-muted-foreground">
                <span>Bufor parsera: {progress.bufferKB.toLocaleString()} KB</span>
                {progress.lastBatchMs > 0 && <span>Ostatni batch: {(progress.lastBatchMs / 1000).toFixed(2)}s</span>}
              </div>
            </div>
          )}

          {error && <div className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

          {log.length > 0 && (
            <pre className="mt-6 max-h-72 overflow-auto rounded-xl border border-border bg-background/60 p-4 text-xs whitespace-pre-wrap text-muted-foreground">{log.join("\n")}</pre>
          )}
        </div>
      </main>
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
  small,
}: {
  label: string;
  value: string;
  accent?: boolean;
  small?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? "border-primary/30 bg-primary/10" : "border-border bg-background/45"}`}>
      <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">{label}</div>
      <div className={`${small ? "text-lg" : "text-xl"} mt-1 font-mono font-bold ${accent ? "text-primary" : "text-foreground"}`}>{value}</div>
    </div>
  );
}
