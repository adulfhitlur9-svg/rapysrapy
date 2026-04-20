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

  // Pomijamy failed I cracked w batchach
  const copyableOnPage = useMemo(
    () => items.filter((x) => x.plaintext === null && !x.failed),
    [items]
  );
  const totalBatches = Math.max(1, Math.ceil(copyableOnPage.length / BATCH_SIZE));
  const currentBatchIdx = Math.min(
    totalBatches - 1,
    Math.floor(batchOffset / BATCH_SIZE)
  );

  const copyBatch = async (offset = batchOffset) => {
    const slice = copyableOnPage.slice(offset, offset + BATCH_SIZE);
    if (slice.length === 0) return alert("Brak hashy do skopiowania (wszystkie odszyfrowane lub oznaczone jako 'nie do złamania')");
    const text = slice.map((x) => x.hash).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setBatchInfo(
        `Skopiowano ${slice.length} hashy (batch ${Math.floor(offset / BATCH_SIZE) + 1}/${totalBatches}). Pomija odszyfrowane i oznaczone jako 'nie do złamania'.`
      );
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
      setImportResult(
        `✅ Zaimportowano ${r.inserted} złamanych haseł. Oznaczono ${r.markedFailed} hashy jako 'nie do złamania' (linie bez ":"). Pominięto ${r.ignoredEmptyPlain} z pustym hasłem.`
      );
      setImportText("");
      await reload();
    } finally {
      setImportBusy(false);
    }
  };

  if (!loaded) {
    return (
      <div className="text-center py-12">
        <button
          onClick={() => reload(1)}
          disabled={busy}
          className="px-6 py-3 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-50"
        >
          {busy ? "Ładowanie hashy…" : "Załaduj listę hashy"}
        </button>
        <p className="text-xs text-muted-foreground mt-3">
          Agregacja ~setek tysięcy haseł — może zająć kilka sekund.
        </p>
      </div>
    );
  }

  return (
    <div>
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <Mini label="Unikalnych hashy" value={stats.uniqueHashes} />
          <Mini label="Odszyfrowanych" value={stats.crackedHashes} accent />
          <Mini label="Nie do złamania" value={stats.failedHashes} danger />
          <Mini label="Kont z hasłem" value={stats.accountsCracked} accent />
          <Mini label="Wszystkich kont" value={stats.accountsTotal} />
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input
          type="text"
          placeholder="Szukaj po hashu lub haśle…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && reload(1)}
          className="flex-1 min-w-[200px] px-4 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={onlyUncracked}
            onChange={(e) => {
              setOnlyUncracked(e.target.checked);
            }}
          />
          tylko nieodszyfrowane
        </label>
        <button
          onClick={() => reload(1)}
          disabled={busy}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
        >
          {busy ? "…" : "Filtruj"}
        </button>
        <button
          onClick={() => copyBatch()}
          className="px-4 py-2 rounded-lg border border-primary/60 bg-primary/10 text-sm font-semibold hover:bg-primary/20"
          title={`Skopiuj kolejne ${BATCH_SIZE} hashy (pomija odszyfrowane i oznaczone jako 'nie do złamania')`}
        >
          📋 Kopiuj batch {currentBatchIdx + 1}/{totalBatches} ({Math.min(BATCH_SIZE, Math.max(0, copyableOnPage.length - batchOffset))} hashy)
        </button>
        <button
          onClick={prevBatch}
          disabled={batchOffset === 0}
          className="px-3 py-2 rounded-lg border border-border text-sm hover:bg-muted disabled:opacity-30"
          title="Poprzedni batch"
        >
          ‹
        </button>
        <button
          onClick={nextBatch}
          className="px-3 py-2 rounded-lg border border-border text-sm hover:bg-muted"
          title="Następny batch (auto-przejście na kolejną stronę)"
        >
          ›
        </button>
        <button
          onClick={() => {
            setImportOpen(true);
            setImportResult(null);
          }}
          className="px-4 py-2 rounded-lg border border-success/60 bg-success/10 text-sm font-semibold hover:bg-success/20"
          title="Wklej odpowiedź z hashes.com"
        >
          📥 Wklej wyniki
        </button>
        <a
          href="https://hashes.com/en/decrypt/hash"
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 rounded-lg border border-primary/40 text-sm text-primary hover:bg-primary/10"
        >
          ↗ hashes.com
        </a>
      </div>

      {batchInfo && (
        <div className="mb-3 px-4 py-2 rounded-lg border border-primary/40 bg-primary/10 text-primary text-sm">
          {batchInfo}
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-2 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-3 text-left w-20">Kont</th>
              <th className="px-3 py-3 text-left">Hash</th>
              <th className="px-3 py-3 text-left">Hasło (plain text)</th>
              <th className="px-3 py-3 text-right w-44">Akcje</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const draft = drafts[it.hash];
              const value = draft ?? it.plaintext ?? "";
              const dirty = draft !== undefined && draft !== (it.plaintext ?? "");
              const rowBg = it.failed
                ? "bg-destructive/10 hover:bg-destructive/15"
                : "hover:bg-muted/20";
              return (
                <tr key={it.hash} className={`border-t border-border ${rowBg}`}>
                  <td className="px-3 py-2 font-mono font-bold text-primary">
                    {it.count.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs break-all max-w-md">
                    <div className="flex items-center gap-2">
                      <span className={it.failed ? "text-destructive line-through" : ""}>
                        {it.hash}
                      </span>
                      {it.failed && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/20 text-destructive font-semibold shrink-0">
                          NIE DO ZŁAMANIA
                        </span>
                      )}
                      <button
                        onClick={() => copy(it.hash)}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-border hover:bg-muted shrink-0"
                        title="Kopiuj hash"
                      >
                        {copiedHash === it.hash ? "✓" : "📋"}
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={value}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [it.hash]: e.target.value }))
                      }
                      onKeyDown={(e) => e.key === "Enter" && handleSave(it.hash)}
                      placeholder={it.plaintext ? "" : "wpisz hasło…"}
                      className={`w-full px-2 py-1 rounded border bg-background text-sm font-mono ${
                        it.plaintext
                          ? "border-success/40 text-success"
                          : "border-border"
                      } ${dirty ? "ring-2 ring-primary" : ""}`}
                    />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => handleToggleFailed(it)}
                      className={`text-xs px-2 py-1 rounded border mr-1 ${
                        it.failed
                          ? "border-success/40 text-success hover:bg-success/10"
                          : "border-destructive/40 text-destructive hover:bg-destructive/10"
                      }`}
                      title={
                        it.failed
                          ? "Odznacz — pozwól znowu kopiować ten hash"
                          : "Oznacz jako 'nie do złamania' — pomijaj przy kopiowaniu"
                      }
                    >
                      {it.failed ? "↺ Odznacz" : "✕ Failed"}
                    </button>
                    <button
                      onClick={() => handleSave(it.hash)}
                      disabled={!dirty && !it.plaintext}
                      className="text-xs px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-30"
                    >
                      {dirty ? "Zapisz" : value ? "Usuń" : "—"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && !busy && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                  Brak hashy
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Paginacja */}
      <div className="flex items-center justify-between mt-4 text-sm">
        <div className="text-muted-foreground">
          Strona {page} / {totalPages}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => reload(1)}
            disabled={page === 1 || busy}
            className="px-3 py-1.5 rounded border border-border hover:bg-muted disabled:opacity-30"
          >
            «
          </button>
          <button
            onClick={() => reload(page - 1)}
            disabled={page === 1 || busy}
            className="px-3 py-1.5 rounded border border-border hover:bg-muted disabled:opacity-30"
          >
            ‹ Poprzednia
          </button>
          <button
            onClick={() => reload(page + 1)}
            disabled={page >= totalPages || busy}
            className="px-3 py-1.5 rounded border border-border hover:bg-muted disabled:opacity-30"
          >
            Następna ›
          </button>
          <button
            onClick={() => reload(totalPages)}
            disabled={page >= totalPages || busy}
            className="px-3 py-1.5 rounded border border-border hover:bg-muted disabled:opacity-30"
          >
            »
          </button>
        </div>
      </div>

      {importOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => !importBusy && setImportOpen(false)}
        >
          <div
            className="bg-card border border-border rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold">Wklej wyniki z hashes.com</h3>
              <button
                onClick={() => !importBusy && setImportOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <div className="p-5 flex-1 overflow-y-auto">
              <p className="text-sm text-muted-foreground mb-3">
                Wklej całą odpowiedź z hashes.com.{" "}
                <strong>Linie z <code className="px-1 bg-muted rounded">hash:hasło</code></strong> zostaną zapisane jako odszyfrowane.{" "}
                <strong>Linie z samym hashem (bez <code>:</code>)</strong> zostaną oznaczone jako{" "}
                <span className="text-destructive font-semibold">'nie do złamania'</span>{" "}
                i będą pomijane przy kolejnym kopiowaniu (możesz je później odznaczyć w tabeli).
                Nagłówki <em>Found:</em>, <em>Left:</em>, <em>Hash Identifier</em> są ignorowane.
              </p>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={`Found:\nq+Mf4aIRPn6L8XQWRRWAKAbTiM9POUzOrOc0Ghgicas=:haslo\noV+K4HZ1v7luCEv7T1L7LCIJEGGq6G4Ot2pV9OUt104=:haslo123\n\nLeft:\nHs7NKXLZkBCZt3Bn/DCa7U3Em6UqV7/9+pH+qNQMiYc=`}
                className="w-full h-72 px-3 py-2 rounded-lg border border-border bg-background font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {importResult && (
                <div className="mt-3 px-4 py-2 rounded-lg border border-border bg-muted/40 text-sm">
                  {importResult}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => setImportOpen(false)}
                disabled={importBusy}
                className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted disabled:opacity-50"
              >
                Zamknij
              </button>
              <button
                onClick={handleImport}
                disabled={importBusy || !importText.trim()}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
              >
                {importBusy ? "Importuję…" : "Zaimportuj"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
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
      className={`rounded-xl border p-3 ${
        danger
          ? "border-destructive/30 bg-destructive/5"
          : accent
            ? "border-primary/30 bg-primary/5"
            : "border-border bg-card"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={`text-xl font-bold font-mono mt-0.5 ${
          danger ? "text-destructive" : accent ? "text-primary" : ""
        }`}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}
