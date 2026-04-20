import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminBulkImportCracks, adminListHashes, adminSaveCrack } from "@/server/cracks.functions";

const BATCH_SIZE = 25;

type HashItem = {
  hash: string;
  count: number;
  plaintext: string | null;
  cracked_at: string | null;
};

type HashStats = {
  uniqueHashes: number;
  crackedHashes: number;
  accountsCracked: number;
  accountsTotal: number;
};

export function HashesTab() {
  const listFn = useServerFn(adminListHashes);
  const saveFn = useServerFn(adminSaveCrack);

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

  const copy = async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedHash(hash);
      setTimeout(() => setCopiedHash((c) => (c === hash ? null : c)), 1200);
    } catch {
      // ignore
    }
  };

  const copyBatch = async () => {
    const text = items
      .filter((x) => x.plaintext === null)
      .map((x) => x.hash)
      .join("\n");
    if (!text) return alert("Brak nieodszyfrowanych hashy na tej stronie");
    try {
      await navigator.clipboard.writeText(text);
      alert(`Skopiowano ${text.split("\n").length} hashy do schowka`);
    } catch {
      alert("Nie udało się skopiować");
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Mini label="Unikalnych hashy" value={stats.uniqueHashes} />
          <Mini label="Odszyfrowanych" value={stats.crackedHashes} accent />
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
          onClick={copyBatch}
          className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted"
          title="Skopiuj wszystkie nieodszyfrowane hashe z tej strony do schowka"
        >
          📋 Kopiuj nieodszyfrowane (ta strona)
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
              <th className="px-3 py-3 text-right w-32">Akcje</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const draft = drafts[it.hash];
              const value = draft ?? it.plaintext ?? "";
              const dirty = draft !== undefined && draft !== (it.plaintext ?? "");
              return (
                <tr key={it.hash} className="border-t border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono font-bold text-primary">
                    {it.count.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs break-all max-w-md">
                    <div className="flex items-center gap-2">
                      <span>{it.hash}</span>
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
    </div>
  );
}

function Mini({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        accent ? "border-primary/30 bg-primary/5" : "border-border bg-card"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold font-mono mt-0.5 ${accent ? "text-primary" : ""}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
