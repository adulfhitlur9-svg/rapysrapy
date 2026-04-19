import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { bulkImport, getStats, verifyAdminToken } from "@/server/users.functions";

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

const BATCH_SIZE = 2000;
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
    done: 0,
    inserted: 0,
    skipped: 0,
    bytesRead: 0,
    totalBytes: 0,
    batchNum: 0,
    elapsedMs: 0,
    lastBatchMs: 0,
  });
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const append = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLog((l) => [...l.slice(-200), `[${ts}] ${msg}`]);
  };

  // Auto-login z sessionStorage (token żyje tylko w bieżącej karcie)
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

  const sendBatch = async (batch: unknown[]) => {
    const res = await bulkImport({ data: { token, records: batch } });
    if (res.error) append(`⚠ ${res.error}`);
    return res;
  };

  // Streamowy parser tablicy JSON: czyta plik chunkami, wyciąga top-level obiekty {...}
  // bez ładowania całości do pamięci. Działa dla `[{...},{...}]` oraz NDJSON.
  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setLog([]);
    const startedAt = performance.now();
    setProgress({
      done: 0,
      inserted: 0,
      skipped: 0,
      bytesRead: 0,
      totalBytes: file.size,
      batchNum: 0,
      elapsedMs: 0,
      lastBatchMs: 0,
    });
    append(`📂 ${file.name} — ${(file.size / 1024 / 1024).toFixed(1)} MB`);
    append(`▶ Start parsowania strumieniowego, batch = ${BATCH_SIZE}`);

    const reader = file.stream().getReader();
    const decoder = new TextDecoder("utf-8");

    // Bufor zawiera tylko nieprzeskanowaną resztę. Skanujemy linearnie od indeksu 0.
    let buffer = "";
    let depth = 0;
    let inString = false;
    let escape = false;
    let objStart = -1;

    let batch: unknown[] = [];
    let totalDone = 0;
    let totalInserted = 0;
    let totalSkipped = 0;
    let totalBytes = 0;
    let batchNum = 0;
    let chunkCount = 0;

    const flush = async () => {
      if (batch.length === 0) return;
      batchNum++;
      const t0 = performance.now();
      const toSend = batch;
      batch = [];
      append(`⇪ Batch #${batchNum}: wysyłam ${toSend.length.toLocaleString()} rekordów…`);
      const res = await sendBatch(toSend);
      const dt = performance.now() - t0;
      totalInserted += res.inserted;
      totalSkipped += res.skipped;
      totalDone += toSend.length;
      const elapsed = performance.now() - startedAt;
      setProgress({
        done: totalDone,
        inserted: totalInserted,
        skipped: totalSkipped,
        bytesRead: totalBytes,
        totalBytes: file.size,
        batchNum,
        elapsedMs: elapsed,
        lastBatchMs: dt,
      });
      append(
        `✓ Batch #${batchNum} OK w ${(dt / 1000).toFixed(1)}s — wstawione +${res.inserted}, pominięte +${res.skipped}`,
      );
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunkCount++;
        totalBytes += value.byteLength;
        buffer += decoder.decode(value, { stream: true });

        if (chunkCount % 20 === 0) {
          const mb = (totalBytes / 1024 / 1024).toFixed(1);
          const pct = ((totalBytes / file.size) * 100).toFixed(1);
          append(`… przeczytano ${mb} MB (${pct}%) · bufor ${(buffer.length / 1024).toFixed(0)} KB`);
        }

        // Skan liniowy bufora
        let i = 0;
        while (i < buffer.length) {
          const ch = buffer[i];
          if (inString) {
            if (escape) escape = false;
            else if (ch === "\\") escape = true;
            else if (ch === '"') inString = false;
          } else if (ch === '"') {
            inString = true;
          } else if (ch === "{") {
            if (depth === 0) objStart = i;
            depth++;
          } else if (ch === "}") {
            depth--;
            if (depth === 0 && objStart >= 0) {
              const slice = buffer.slice(objStart, i + 1);
              try {
                batch.push(JSON.parse(slice));
              } catch {
                totalSkipped++;
              }
              objStart = -1;

              if (batch.length >= BATCH_SIZE) {
                // Utnij przeskanowany fragment, kontynuuj parsowanie reszty
                buffer = buffer.slice(i + 1);
                i = -1; // bo zaraz i++
                await flush();
              }
            }
          }
          i++;
        }

        // Po pełnym przeskanowaniu obecnego bufora:
        // - jeśli jesteśmy w środku obiektu → zachowaj od jego początku
        // - jeśli nie → wyrzuć cały bufor (to były przecinki/białe znaki/nawiasy tablicy)
        if (depth > 0 && objStart >= 0) {
          buffer = buffer.slice(objStart);
          objStart = 0;
        } else {
          buffer = "";
        }

        // Aktualizuj postęp odczytu między batchami (żeby pasek się ruszał)
        setProgress((p) => ({ ...p, bytesRead: totalBytes, elapsedMs: performance.now() - startedAt }));
      }

      buffer += decoder.decode();
      // Domknij ewentualny ostatni obiekt jeśli nie był jeszcze pushed
      append(`◼ Koniec strumienia. Wysyłam ostatni batch (${batch.length} rekordów)…`);
      await flush();
      const total = (performance.now() - startedAt) / 1000;
      append(
        `🎉 Gotowe w ${total.toFixed(1)}s · wstawione ${totalInserted.toLocaleString()} · pominięte ${totalSkipped.toLocaleString()} · batchy ${batchNum}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      append(`✗ Błąd: ${msg}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  // ---------- UI: bramka hasła ----------
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
          {authError && (
            <div className="mt-3 text-sm text-destructive">{authError}</div>
          )}
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

  const pct = progress.done > 0 ? Math.min(99, Math.round((progress.done / Math.max(progress.done, 1)) * 100)) : 0;

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
          Wybierz lokalny plik <code className="font-mono">archivo.json</code>. Parsowanie
          strumieniowe — plik nie jest ładowany w całości do pamięci. Batche po {BATCH_SIZE}.
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
            Obsługa dużych plików (setki MB) — parser strumieniowy
          </div>
        </label>

        {(busy || progress.done > 0) && (
          <div className="rounded-2xl border border-border bg-card p-6 mt-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">
                Przetworzono: {progress.done.toLocaleString()}
              </span>
              <span className="font-mono">{busy ? `${pct}%` : "100%"}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full bg-primary transition-all duration-200 ${busy ? "animate-pulse" : ""}`}
                style={{ width: busy ? `${pct}%` : "100%" }}
              />
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Wstawione</div>
                <div className="font-mono font-bold text-success">
                  {progress.inserted.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Pominięte</div>
                <div className="font-mono font-bold text-muted-foreground">
                  {progress.skipped.toLocaleString()}
                </div>
              </div>
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
