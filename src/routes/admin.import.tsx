import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { bulkImport, getStats } from "@/server/users.functions";

export const Route = createFileRoute("/admin/import")({
  head: () => ({
    meta: [
      { title: "Import archivo.json — userlookup" },
      { name: "description", content: "Załaduj plik archivo.json do bazy w batchach po 1000." },
    ],
  }),
  loader: () => getStats(),
  component: ImportPage,
});

const BATCH_SIZE = 1000;

export function ImportPage() {
  const initial = Route.useLoaderData();
  const [total, setTotal] = useState(initial.total);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, inserted: 0, skipped: 0 });
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const append = (msg: string) => setLog((l) => [...l.slice(-50), msg]);

  useEffect(() => {
    if (!busy) {
      getStats().then((s) => setTotal(s.total)).catch(() => {});
    }
  }, [busy]);

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setLog([]);
    setProgress({ done: 0, total: 0, inserted: 0, skipped: 0 });
    append(`Wczytuję ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)…`);

    try {
      const text = await file.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Plik nie jest poprawnym JSON-em");
      }

      let records: unknown[];
      if (Array.isArray(data)) {
        records = data;
      } else if (data && typeof data === "object") {
        // Dopuszczamy { users: [...] } lub mapę nick -> rekord
        const obj = data as Record<string, unknown>;
        if (Array.isArray(obj.users)) records = obj.users as unknown[];
        else if (Array.isArray(obj.data)) records = obj.data as unknown[];
        else {
          records = Object.entries(obj).map(([k, v]) =>
            v && typeof v === "object" && !("name" in (v as object))
              ? { name: k, ...(v as object) }
              : v,
          );
        }
      } else {
        throw new Error("Nieobsługiwany format JSON");
      }

      append(`Znaleziono ${records.length.toLocaleString()} rekordów. Wysyłam w batchach po ${BATCH_SIZE}…`);
      setProgress({ done: 0, total: records.length, inserted: 0, skipped: 0 });

      let inserted = 0;
      let skipped = 0;
      for (let i = 0; i < records.length; i += BATCH_SIZE) {
        const batch = records.slice(i, i + BATCH_SIZE);
        const res = await bulkImport({ data: { records: batch } });
        inserted += res.inserted;
        skipped += res.skipped;
        if (res.error) append(`⚠ batch ${i}: ${res.error}`);
        setProgress({ done: i + batch.length, total: records.length, inserted, skipped });
      }
      append(`✓ Gotowe. Wstawiono ${inserted.toLocaleString()}, pominięto ${skipped.toLocaleString()}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      append(`✗ Błąd: ${msg}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← powrót
        </Link>
        <h1 className="text-3xl font-bold mt-4 mb-2">Import archivo.json</h1>
        <p className="text-muted-foreground mb-8">
          Wybierz lokalny plik <code className="font-mono">archivo.json</code>. Parsowanie
          odbywa się w przeglądarce, dane lecą batchami po {BATCH_SIZE} do bazy.
        </p>

        <div className="rounded-2xl border border-border bg-card p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
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
            JSON: tablica rekordów lub obiekt {"{ users: [...] }"}
          </div>
        </label>

        {(busy || progress.total > 0) && (
          <div className="rounded-2xl border border-border bg-card p-6 mt-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted-foreground">
                {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
              </span>
              <span className="font-mono">{pct}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-200"
                style={{ width: `${pct}%` }}
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
