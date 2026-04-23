import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  adminBulkImportCracks,
  adminListHashes,
  adminSaveCrack,
  adminToggleHashFailed,
} from "@/server/cracks.functions";

const BATCH_SIZE = 25;

type HashItem = {
  hash: string;
  count: number;
  plaintext: string | null;
  cracked_at: string | null;
  failed: boolean;
  failed_at: string | null;
};

type HashStats = {
  uniqueHashes: number;
  crackedHashes: number;
  failedHashes: number;
  accountsCracked: number;
  accountsTotal: number;
};

export function HashesTab() {
  const listFn = useServerFn(adminListHashes);
  const saveFn = useServerFn(adminSaveCrack);
  const importFn = useServerFn(adminBulkImportCracks);
  const toggleFailedFn = useServerFn(adminToggleHashFailed);

  const [items, setItems] = useState<HashItem[]>([]);
  const [stats, setStats] = useState<HashStats | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [onlyUncracked, setOnlyUncracked] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [batchOffset, setBatchOffset] = useState(0);
  const [batchInfo, setBatchInfo] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  const reload = async (p = page) => {
    setBusy(true);
    setError(null);
    try {
      const r = await listFn({ data: { page: p, pageSize: 100, onlyUncracked, search } });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setItems(r.items);
      setStats(r.stats);
      setPage(r.page);
      setTotalPages(r.totalPages);
      setLoaded(true);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (hash: string) => {
    const plaintext = drafts[hash] ?? "";
    const r = await saveFn({ data: { hash, plaintext } });
    if (!r.ok) return alert(r.error);
    setDrafts((d) => {
      const n = { ...d };
      delete n[hash];
      return n;
    });
    await reload();
  };

  const handleToggleFailed = async (item: HashItem) => {
    const r = await toggleFailedFn({ data: { hash: item.hash, failed: !item.failed } });
    if (!r.ok) return alert(r.error);
    await reload();
  };

  const copy = async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedHash(hash);
      setTimeout(() => setCopiedHash((c) => (c === hash ? null : c)), 1200);
    } catch {
      // ignore
    }
  };

  const copyableOnPage = useMemo(() => items.filter((x) => x.plaintext === null && !x.failed), [items]);
  const totalBatches = Math.max(1, Math.ceil(copyableOnPage.length / BATCH_SIZE));
  const currentBatchIdx = Math.min(totalBatches - 1, Math.floor(batchOffset / BATCH_SIZE));

  const copyBatch = async (offset = batchOffset) => {
    const slice = copyableOnPage.slice(offset, offset + BATCH_SIZE);
    if (slice.length === 0) return alert("Brak hashy do skopiowania (wszystkie odszyfrowane lub oznaczone jako 'nie do złamania')");
    const text = slice.map((x) => x.hash).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setBatchInfo(`Skopiowano ${slice.length} hashy (batch ${Math.floor(offset / BATCH_SIZE) + 1}/${totalBatches}).`);
      setTimeout(() => setBatchInfo(null), 3500);
    } catch {
      alert("Nie udało się skopiować");
    }
  };

  const nextBatch = async () => {
    const next = batchOffset + BATCH_SIZE;
    if (next >= copyableOnPage.length) {
      if (page < totalPages) {
        setBatchOffset(0);
        await reload(page + 1);
      } else {
        alert("To był ostatni batch");
      }
      return;
    }
    setBatchOffset(next);
    await copyBatch(next);
  };

  const prevBatch = async () => {
    const prev = Math.max(0, batchOffset - BATCH_SIZE);
    setBatchOffset(prev);
    await copyBatch(prev);
  };

  const handleImport = async () => {
    if (!importText.trim()) return;
    setImportBusy(true);
    setImportResult(null);
    try {
      const r = await importFn({ data: { text: importText } });
      if (!r.ok) {
        setImportResult(`❌ ${r.error}`);
        return;
      }
      setImportResult(`✅ Zaimportowano ${r.inserted} złamanych haseł. Oznaczono ${r.markedFailed} jako 'nie do złamania'. Pominięto ${r.ignoredEmptyPlain} pustych.`);
      setImportText("");
      await reload();
    } finally {
      setImportBusy(false);
    }
  };

  if (!loaded) {
    return (
      <div className="text-center py-8">
        <button
          onClick={() => reload(1)}
          disabled={busy}
          className="rounded-lg border border-primary/30 bg-primary px-6 py-3 font-semibold text-primary-foreground shadow-[var(--shadow-glow)] disabled:opacity-50"
        >
          {busy ? "Ładowanie hashy…" : "Załaduj listę hashy"}
        </button>
        <p className="mt-3 text-xs text-muted-foreground">Agregacja dużej liczby hashy może zająć kilka sekund.</p>
      </div>
    );
  }

  return (
    <div>
      {stats && (
        <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Mini label="Unikalnych hashy" value={stats.uniqueHashes} />
          <Mini label="Odszyfrowanych" value={stats.crackedHashes} accent />
          <Mini label="Nie do złamania" value={stats.failedHashes} danger />
          <Mini label="Kont z hasłem" value={stats.accountsCracked} accent />
          <Mini label="Wszystkich kont" value={stats.accountsTotal} />
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">⌕</span>
          <input
            type="text"
            placeholder="Szukaj po hashu lub haśle…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && reload(1)}
            className="h-12 w-full rounded-lg border border-border bg-input pl-11 pr-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <label className="flex h-12 items-center gap-3 rounded-lg border border-border bg-background/60 px-4 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyUncracked}
            onChange={(e) => setOnlyUncracked(e.target.checked)}
            className="h-4 w-4 accent-[var(--color-primary)]"
          />
          tylko nieodszyfrowane
        </label>
        <ControlButton onClick={() => reload(1)} disabled={busy} variant="primary">
          {busy ? "…" : "Filtruj"}
        </ControlButton>
        <ControlButton onClick={() => copyBatch()}>
          📋 Batch {currentBatchIdx + 1}/{totalBatches}
        </ControlButton>
        <ControlButton onClick={prevBatch} disabled={batchOffset === 0 || busy}>
          ‹
        </ControlButton>
        <ControlButton onClick={nextBatch} disabled={busy}>
          ›
        </ControlButton>
        <ControlButton onClick={() => {
          setImportOpen(true);
          setImportResult(null);
        }} variant="success">
          📥 Wklej wyniki
        </ControlButton>
        <a
          href="https://hashes.com/en/decrypt/hash"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-12 items-center rounded-lg border border-border bg-background/60 px-4 text-sm text-muted-foreground transition hover:text-foreground"
        >
          ↗ hashes.com
        </a>
      </div>

      {batchInfo && <div className="mb-4 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">{batchInfo}</div>}
      {error && <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}

      <div className="overflow-x-auto rounded-2xl border border-border bg-background/45">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-muted/30 text-xs uppercase tracking-[0.22em] text-muted-foreground">
            <tr>
              <th className="w-24 px-4 py-3 text-left">Kont</th>
              <th className="px-4 py-3 text-left">Hash</th>
              <th className="px-4 py-3 text-left">Hasło</th>
              <th className="w-52 px-4 py-3 text-right">Akcje</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const draft = drafts[it.hash];
              const value = draft ?? it.plaintext ?? "";
              const dirty = draft !== undefined && draft !== (it.plaintext ?? "");
              const rowBg = it.failed ? "bg-destructive/8 hover:bg-destructive/12" : "hover:bg-muted/20";
              return (
                <tr key={it.hash} className={`border-t border-border/80 transition ${rowBg}`}>
                  <td className="px-4 py-3 font-mono font-bold text-primary">{it.count.toLocaleString()}</td>
                  <td className="px-4 py-3 font-mono text-xs break-all">
                    <div className="flex items-center gap-2">
                      <span className={it.failed ? "text-destructive line-through" : "text-foreground"}>{it.hash}</span>
                      {it.failed && <span className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-destructive">failed</span>}
                      <button
                        onClick={() => copy(it.hash)}
                        className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground transition hover:text-foreground"
                        title="Kopiuj hash"
                      >
                        {copiedHash === it.hash ? "✓" : "📋"}
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => setDrafts((d) => ({ ...d, [it.hash]: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && handleSave(it.hash)}
                      placeholder={it.plaintext ? "" : "wpisz hasło…"}
                      className={`h-10 w-full rounded-lg border bg-input px-3 text-sm font-mono outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30 ${
                        it.plaintext ? "border-success/40 text-success" : "border-border text-foreground"
                      } ${dirty ? "ring-2 ring-primary/30" : ""}`}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <ControlButton onClick={() => handleToggleFailed(it)} variant={it.failed ? "success" : "danger"}>
                        {it.failed ? "↺ Odznacz" : "✕ Failed"}
                      </ControlButton>
                      <ControlButton onClick={() => handleSave(it.hash)} disabled={!dirty && !it.plaintext}>
                        {dirty ? "Zapisz" : value ? "Usuń" : "—"}
                      </ControlButton>
                    </div>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && !busy && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-sm text-muted-foreground">Brak hashy.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4 text-sm">
        <div className="text-muted-foreground">Strona {page} / {totalPages}</div>
        <div className="flex gap-2">
          <ControlButton onClick={() => reload(1)} disabled={page === 1 || busy}>«</ControlButton>
          <ControlButton onClick={() => reload(page - 1)} disabled={page === 1 || busy}>‹ Poprzednia</ControlButton>
          <ControlButton onClick={() => reload(page + 1)} disabled={page >= totalPages || busy}>Następna ›</ControlButton>
          <ControlButton onClick={() => reload(totalPages)} disabled={page >= totalPages || busy}>»</ControlButton>
        </div>
      </div>

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !importBusy && setImportOpen(false)}>
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-card)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="font-semibold tracking-tight">Wklej wyniki z hashes.com</h3>
              <button onClick={() => !importBusy && setImportOpen(false)} className="text-muted-foreground transition hover:text-foreground">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
                Linie w formacie <code className="rounded bg-muted px-1 text-foreground">hash:hasło</code> zapiszą odszyfrowane hasła. Linie z samym hashem zostaną oznaczone jako nie do złamania.
              </p>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={`Found:\nq+Mf4aIRPn6L8XQWRRWAKAbTiM9POUzOrOc0Ghgicas=:haslo\noV+K4HZ1v7luCEv7T1L7LCIJEGGq6G4Ot2pV9OUt104=:haslo123\n\nLeft:\nHs7NKXLZkBCZt3Bn/DCa7U3Em6UqV7/9+pH+qNQMiYc=`}
                className="h-72 w-full rounded-lg border border-border bg-input px-3 py-2 font-mono text-xs outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
              />
              {importResult && <div className="mt-3 rounded-lg border border-border bg-background/60 px-4 py-3 text-sm">{importResult}</div>}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
              <ControlButton onClick={() => setImportOpen(false)} disabled={importBusy}>Zamknij</ControlButton>
              <ControlButton onClick={handleImport} disabled={importBusy || !importText.trim()} variant="primary">
                {importBusy ? "Importuję…" : "Zaimportuj"}
              </ControlButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ControlButton({
  children,
  onClick,
  disabled,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "success" | "danger";
}) {
  const tone =
    variant === "primary"
      ? "border-primary/30 bg-primary text-primary-foreground shadow-[var(--shadow-glow)] hover:opacity-90"
      : variant === "success"
        ? "border-success/30 bg-success/10 text-success hover:bg-success/15"
        : variant === "danger"
          ? "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15"
          : "border-border bg-background/60 text-muted-foreground hover:text-foreground";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-12 items-center rounded-lg border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${tone}`}
    >
      {children}
    </button>
  );
}

function Mini({
  label,
  value,
  accent,
  danger,
}: {
  label: string;
  value: number;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        danger
          ? "border-destructive/30 bg-destructive/10"
          : accent
            ? "border-primary/30 bg-primary/10"
            : "border-border bg-background/45"
      }`}
    >
      <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-bold font-mono ${danger ? "text-destructive" : accent ? "text-primary" : "text-foreground"}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
