import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { searchUser, getStats } from "@/server/users.functions";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "User Lookup — wyszukiwarka graczy" },
      {
        name: "description",
        content:
          "Szybkie wyszukiwanie graczy w bazie 1M+ rekordów. Premium, IP, Discord, powiązane konta — wszystko w jednym miejscu.",
      },
      { property: "og:title", content: "User Lookup" },
      { property: "og:description", content: "Wyszukiwarka graczy z bazy 1M+ rekordów." },
    ],
  }),
  loader: () => getStats().catch(() => ({ total: 0, premium: 0, cracked: 0, withDiscord: 0 })),
  component: HomePage,
});

type SearchResult = Awaited<ReturnType<typeof searchUser>>;
type HistoryEntry = { name: string; at: number; found: boolean };

const HISTORY_KEY = "userlookup_history_v1";
const HISTORY_MAX = 20;

function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_MAX)));
  } catch {
    /* ignore */
  }
}

function HomePage() {
  const { user, isAdmin, logout } = useAuth();
  const stats = Route.useLoaderData();
  const [query, setQuery] = useState("");
  const [fuzzy, setFuzzy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [submittedName, setSubmittedName] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const runSearch = async (name: string, useFuzzy: boolean) => {
    if (!name) return;
    setLoading(true);
    setResult(null);
    setSubmittedName(name);
    try {
      const res = await searchUser({ data: { name, fuzzy: useFuzzy } });
      setResult(res);

      const next: HistoryEntry[] = [
        { name, at: Date.now(), found: !!res.found },
        ...history.filter((h) => h.name.toLowerCase() !== name.toLowerCase()),
      ].slice(0, HISTORY_MAX);
      setHistory(next);
      saveHistory(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Błąd wyszukiwania";
      setResult({ found: false, user: null, suggestions: [], error: msg } as SearchResult);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(query.trim(), fuzzy);
  };

  const pickSuggestion = (name: string) => {
    setQuery(name);
    runSearch(name, false);
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  const premiumPct = stats.total ? ((stats.premium / stats.total) * 100).toFixed(1) : "0";
  const crackedPct = stats.total ? ((stats.cracked / stats.total) * 100).toFixed(1) : "0";

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between border-b border-border/50 backdrop-blur-sm">
        <h1 className="text-xl font-bold tracking-tight">
          <span className="text-primary">::</span> userlookup
        </h1>
        <div className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              <span className="text-muted-foreground hidden sm:inline">
                <span className="text-foreground font-mono font-semibold">{user.nick}</span>
                {isAdmin && (
                  <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary align-middle">
                    ADMIN
                  </span>
                )}
              </span>
              {isAdmin && (
                <Link
                  to="/admin/accounts"
                  className="text-muted-foreground hover:text-foreground transition"
                >
                  Panel admina
                </Link>
              )}
              <button
                onClick={() => logout()}
                className="text-muted-foreground hover:text-destructive transition"
              >
                Wyloguj
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-muted-foreground hover:text-foreground transition">
                Logowanie
              </Link>
              <Link
                to="/register"
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-semibold hover:opacity-90"
              >
                Rejestracja
              </Link>
            </>
          )}
        </div>
      </header>

      <main className="flex-1 px-4 pt-10 pb-20">
        <div className="max-w-7xl mx-auto">
          {/* Hero + search */}
          <div className="text-center mb-10">
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground mb-4">
              Database lookup
            </p>
            <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-3">
              Znajdź <span className="text-primary">gracza</span>.
            </h2>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              Wpisz nick. Sprawdź premium, IP, Discord, powiązane konta — w mniej niż sekundę.
            </p>

            {user ? (
              <div className="max-w-2xl mx-auto">
                <form onSubmit={handleSubmit} className="flex gap-2">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="np. Zatwardzeniuch"
                    maxLength={64}
                    autoComplete="off"
                    spellCheck={false}
                    className="flex-1 h-14 px-5 rounded-xl bg-input border border-border focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none text-lg font-mono transition"
                  />
                  <button
                    type="submit"
                    disabled={loading || !query.trim()}
                    className="h-14 px-8 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-[var(--shadow-glow)]"
                  >
                    {loading ? <Spinner /> : "Szukaj"}
                  </button>
                </form>

                <div className="mt-3 flex justify-between items-center text-xs">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="text-muted-foreground hover:text-foreground transition flex items-center gap-1"
                  >
                    <span>{showAdvanced ? "▼" : "▶"}</span> Zaawansowane opcje wyszukiwania
                  </button>
                  {history.length > 0 && (
                    <span className="text-muted-foreground">
                      Historia: {history.length}/{HISTORY_MAX}
                    </span>
                  )}
                </div>

                {showAdvanced && (
                  <div className="mt-3 rounded-xl border border-border bg-card/50 p-5 text-left text-sm space-y-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={fuzzy}
                        onChange={(e) => setFuzzy(e.target.checked)}
                        className="mt-1 h-4 w-4 accent-primary"
                      />
                      <div>
                        <div className="font-semibold">
                          Fuzzy search{" "}
                          <span className="text-xs text-muted-foreground font-normal">
                            (tolerancja literówek)
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                          Jeśli dokładny nick nie zostanie znaleziony, automatycznie wyszuka
                          podobne — np. <code className="text-foreground">incognto</code> →{" "}
                          <code className="text-foreground">incognito</code>, lub{" "}
                          <code className="text-foreground">koks123</code> →{" "}
                          <code className="text-foreground">koks1234</code>. Pokażemy do 20
                          sugestii z fragmentem pasującym do zapytania.
                        </p>
                      </div>
                    </label>
                    <div className="text-xs text-muted-foreground border-t border-border pt-3">
                      💡 <strong className="text-foreground">Tip:</strong> nicki są
                      case-insensitive. Dozwolone znaki:{" "}
                      <code className="text-foreground">A-Z 0-9 _ . -</code>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="max-w-md mx-auto rounded-2xl border border-border bg-card/50 p-8 text-center">
                <div className="text-3xl mb-3">🔒</div>
                <h3 className="text-lg font-semibold mb-2">Dostęp tylko dla zalogowanych</h3>
                <p className="text-sm text-muted-foreground mb-5">
                  Załóż darmowe konto żeby przeszukiwać bazę.
                </p>
                <div className="flex gap-2 justify-center">
                  <Link
                    to="/register"
                    className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90"
                  >
                    Załóż konto
                  </Link>
                  <Link
                    to="/login"
                    className="px-5 py-2.5 rounded-xl border border-border hover:bg-muted font-semibold"
                  >
                    Zaloguj się
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* Dashboard stats */}
          {!result && !loading && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-4xl mx-auto mb-10">
              <StatCard label="Konta w bazie" value={stats.total.toLocaleString("pl-PL")} />
              <StatCard
                label="Premium"
                value={`${premiumPct}%`}
                sub={`${stats.premium.toLocaleString("pl-PL")} kont`}
                accent="success"
              />
              <StatCard
                label="Cracked hashe"
                value={stats.cracked.toLocaleString("pl-PL")}
                sub={`${crackedPct}% bazy`}
                accent="primary"
              />
              <StatCard
                label="Z Discordem"
                value={stats.withDiscord.toLocaleString("pl-PL")}
              />
            </div>
          )}

          {/* Layout: results + history sidebar */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
            <div className="min-w-0">
              {loading && (
                <div className="text-center py-20 text-muted-foreground flex flex-col items-center gap-4">
                  <Spinner large />
                  <span className="text-sm">Wyszukiwanie i ping IP…</span>
                </div>
              )}

              {!loading && result && !result.found && (
                <NotFoundCard
                  submittedName={submittedName}
                  error={result.error}
                  suggestions={result.suggestions ?? []}
                  fuzzyEnabled={fuzzy}
                  onPick={pickSuggestion}
                  onEnableFuzzy={() => {
                    setFuzzy(true);
                    setShowAdvanced(true);
                    if (submittedName) runSearch(submittedName, true);
                  }}
                />
              )}

              {!loading && result?.found && result.user && <UserCard user={result.user} />}

              {!result && !loading && user && (
                <div className="rounded-2xl border border-dashed border-border bg-card/30 p-10 text-center text-muted-foreground">
                  <div className="text-4xl mb-3">🔎</div>
                  <p className="text-sm">Wyniki pojawią się tutaj.</p>
                </div>
              )}
            </div>

            {/* History sidebar */}
            {user && (
              <aside className="lg:sticky lg:top-6 self-start rounded-2xl border border-border bg-card/50 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
                    Historia
                  </h3>
                  {history.length > 0 && (
                    <button
                      onClick={clearHistory}
                      className="text-xs text-muted-foreground hover:text-destructive transition"
                    >
                      Wyczyść
                    </button>
                  )}
                </div>
                {history.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    Brak wyszukiwań.
                  </p>
                ) : (
                  <ul className="space-y-1 max-h-[500px] overflow-y-auto pr-1">
                    {history.map((h) => (
                      <li key={h.name + h.at}>
                        <button
                          onClick={() => {
                            setQuery(h.name);
                            runSearch(h.name, fuzzy);
                          }}
                          className="w-full text-left flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-muted transition group"
                        >
                          <span className="font-mono text-sm truncate flex items-center gap-2">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${h.found ? "bg-success" : "bg-muted-foreground"}`}
                            />
                            {h.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100">
                            {timeAgo(h.at)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </aside>
            )}
          </div>
        </div>
      </main>

      <footer className="px-6 py-4 text-center text-xs text-muted-foreground border-t border-border/50">
        userlookup · search by nickname · {stats.total.toLocaleString("pl-PL")}+ records
      </footer>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "success" | "primary";
}) {
  const accentClass =
    accent === "success" ? "text-success" : accent === "primary" ? "text-primary" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card/50 p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
        {label}
      </div>
      <div className={`text-2xl font-bold font-mono ${accentClass}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function NotFoundCard({
  submittedName,
  error,
  suggestions,
  fuzzyEnabled,
  onPick,
  onEnableFuzzy,
}: {
  submittedName: string | null;
  error: string | null;
  suggestions: Array<{ name: string; premium: boolean }>;
  fuzzyEnabled: boolean;
  onPick: (name: string) => void;
  onEnableFuzzy: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/50 p-10 text-center">
      <div className="text-5xl mb-3">∅</div>
      <h3 className="text-xl font-semibold mb-1">{error ? "Błąd" : "Nie znaleziono"}</h3>
      <p className="text-muted-foreground text-sm mb-4">
        {error ?? (
          <>
            Brak użytkownika o nicku{" "}
            <span className="font-mono text-foreground">{submittedName}</span>.
          </>
        )}
      </p>

      {!error && !fuzzyEnabled && (
        <button
          onClick={onEnableFuzzy}
          className="px-4 py-2 rounded-lg bg-accent text-accent-foreground text-sm font-semibold hover:opacity-90 transition"
        >
          🔍 Spróbuj fuzzy search
        </button>
      )}

      {suggestions.length > 0 && (
        <div className="mt-6 text-left">
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3 text-center">
            Podobne nicki ({suggestions.length})
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            {suggestions.map((s) => (
              <button
                key={s.name}
                onClick={() => onPick(s.name)}
                className="px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/70 border border-border font-mono text-sm transition flex items-center gap-2"
              >
                {s.premium && <span className="text-success text-xs">★</span>}
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UserCard({ user }: { user: NonNullable<SearchResult["user"]> }) {
  const nameMcUrl = user.premium
    ? `https://pl.namemc.com/profile/${encodeURIComponent(user.name)}`
    : null;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Top row: info + skin */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        {/* Info table */}
        <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-card)] overflow-hidden order-2 lg:order-1">
          <div className="px-6 py-5 border-b border-border flex flex-wrap items-center gap-3 justify-between">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                Nickname
              </div>
              <div className="text-2xl font-bold font-mono">{user.name}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {user.premium ? (
                <span className="px-3 py-1 rounded-full bg-success/15 text-success text-xs font-semibold border border-success/30">
                  ★ PREMIUM
                </span>
              ) : (
                <span className="px-3 py-1 rounded-full bg-muted text-muted-foreground text-xs font-semibold border border-border">
                  CRACKED
                </span>
              )}
              {nameMcUrl && (
                <a
                  href={nameMcUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1 rounded-full bg-accent text-accent-foreground text-xs font-semibold hover:opacity-90 transition"
                >
                  NameMC ↗
                </a>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                <Row label="Password (hash)">
                  {user.password ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <code className="font-mono text-xs bg-muted px-2 py-1 rounded break-all max-w-md">
                        {user.password}
                      </code>
                      <a
                        href="https://hashes.com/en/decrypt/hash"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-xs font-semibold hover:opacity-90 transition whitespace-nowrap"
                      >
                        Sprawdź hash ↗
                      </a>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Row>
                <Row label="Password (hasło)">
                  {user.passwordPlain ? (
                    <code className="font-mono text-sm font-bold bg-success/10 text-success px-2 py-1 rounded border border-success/30 break-all">
                      {user.passwordPlain}
                    </code>
                  ) : (
                    <span className="text-muted-foreground text-xs italic">
                      {user.password ? "jeszcze nie odszyfrowane" : "—"}
                    </span>
                  )}
                </Row>
                <Row label="Premium">
                  <span className={user.premium ? "text-success" : "text-muted-foreground"}>
                    {user.premium ? "true" : "false"}
                  </span>
                </Row>
                <Row label="First IP">
                  <IpCell ip={user.firstIP} status={user.firstIpStatus} />
                </Row>
                <Row label="Last IP">
                  <IpCell ip={user.lastIP} status={user.lastIpStatus} />
                </Row>
                <Row label="Discord email">
                  {user.discordEmail ? (
                    <code className="font-mono text-xs">{user.discordEmail}</code>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Row>
              </tbody>
            </table>
          </div>
        </div>

        {/* Skin viewer for premium */}
        {user.premium && (
          <div className="order-1 lg:order-2">
            <SkinViewer name={user.name} />
          </div>
        )}
      </div>

      {/* Related accounts */}
      {user.related && user.related.length > 0 && (
        <RelatedAccounts related={user.related} />
      )}
    </div>
  );
}

function SkinViewer({ name }: { name: string }) {
  const [angle, setAngle] = useState(20);
  const [auto, setAuto] = useState(true);
  const dragRef = useRef<{ active: boolean; startX: number; startAngle: number }>({
    active: false,
    startX: 0,
    startAngle: 0,
  });

  // Auto-rotate
  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => setAngle((a) => (a + 2) % 360), 60);
    return () => window.clearInterval(id);
  }, [auto]);

  const skinUrl = useMemo(
    () =>
      `https://mc-heads.net/body/${encodeURIComponent(name)}/256?rotation=${Math.round(((angle % 360) + 360) % 360)}`,
    [name, angle],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    setAuto(false);
    dragRef.current = { active: true, startX: e.clientX, startAngle: angle };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    const delta = e.clientX - dragRef.current.startX;
    setAngle(dragRef.current.startAngle + delta);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current.active = false;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-gradient-to-br from-card via-card to-primary/5 shadow-[var(--shadow-card)] overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
          Skin 3D
        </div>
        <button
          onClick={() => setAuto((a) => !a)}
          className={`text-xs px-2 py-1 rounded-md transition ${
            auto
              ? "bg-primary/20 text-primary"
              : "bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          {auto ? "⏸ Pauza" : "▶ Auto-obrót"}
        </button>
      </div>
      <div
        className="relative h-[360px] flex items-center justify-center cursor-grab active:cursor-grabbing select-none touch-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 60%, color-mix(in oklab, var(--primary) 18%, transparent), transparent 60%), repeating-linear-gradient(45deg, transparent 0 12px, color-mix(in oklab, var(--border) 30%, transparent) 12px 13px)",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          src={skinUrl}
          alt={`Skin gracza ${name}`}
          width={180}
          height={320}
          className="h-[320px] w-auto pointer-events-none drop-shadow-[0_20px_30px_rgba(0,0,0,0.5)] [image-rendering:pixelated]"
          draggable={false}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.opacity = "0.3";
          }}
        />
        <div className="absolute bottom-2 left-0 right-0 text-center text-[10px] uppercase tracking-widest text-muted-foreground/80">
          ← przeciągnij aby obrócić →
        </div>
      </div>
    </div>
  );
}

type Related = NonNullable<NonNullable<SearchResult["user"]>["related"]>[number];

function RelatedAccounts({ related }: { related: Related[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, { matchType: Related["matchType"]; matchValue: string; items: Related[] }>();
    for (const r of related) {
      const key = `${r.matchType}::${r.matchValue}`;
      if (!map.has(key))
        map.set(key, { matchType: r.matchType, matchValue: r.matchValue, items: [] });
      map.get(key)!.items.push(r);
    }
    return Array.from(map.values());
  }, [related]);

  const labelFor = (t: Related["matchType"]) =>
    t === "first_ip" ? "First IP" : t === "last_ip" ? "Last IP" : "Discord email";

  return (
    <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-card)] overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Powiązane konta
          </div>
          <div className="text-sm text-muted-foreground mt-0.5">
            Inne konta z tego samego IP lub Discorda · {related.length} znalezionych
          </div>
        </div>
        <span className="px-2 py-1 rounded-md bg-primary/15 text-primary text-xs font-semibold">
          {related.length}
        </span>
      </div>
      <div className="divide-y divide-border">
        {groups.map((g) => (
          <div key={`${g.matchType}-${g.matchValue}`} className="px-6 py-4">
            <div className="text-xs text-muted-foreground mb-2 flex items-center gap-2">
              <span className="uppercase tracking-wider">{labelFor(g.matchType)}:</span>
              <code className="font-mono text-foreground">{g.matchValue}</code>
              <span className="text-muted-foreground">· {g.items.length}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {g.items.map((it) => (
                <span
                  key={it.name}
                  className="px-3 py-1.5 rounded-lg bg-muted border border-border font-mono text-sm flex items-center gap-2"
                >
                  {it.premium && <span className="text-success text-xs">★</span>}
                  {it.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-6 py-4 text-muted-foreground text-xs uppercase tracking-wider w-48 align-top">
        {label}
      </td>
      <td className="px-6 py-4">{children}</td>
    </tr>
  );
}

function IpCell({
  ip,
  status,
}: {
  ip: string | null;
  status: "reachable" | "not reachable" | "unknown";
}) {
  if (!ip) return <span className="text-muted-foreground">—</span>;
  const color =
    status === "reachable"
      ? "bg-success text-success"
      : status === "not reachable"
        ? "bg-destructive text-destructive"
        : "bg-muted-foreground text-muted-foreground";
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <code className="font-mono">{ip}</code>
      <span
        className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider ${color.split(" ")[1]}`}
      >
        <span className={`h-2 w-2 rounded-full ${color.split(" ")[0]} animate-pulse`} />
        {status}
      </span>
    </div>
  );
}

function Spinner({ large = false }: { large?: boolean }) {
  const size = large ? "h-8 w-8 border-[3px]" : "h-5 w-5 border-2";
  return (
    <span
      className={`inline-block ${size} rounded-full border-current border-t-transparent animate-spin`}
    />
  );
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
