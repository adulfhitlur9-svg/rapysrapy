import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { searchUser, getStats } from "@/server/users.functions";
import { useAuth } from "@/lib/auth-context";
import { RANK_LABELS } from "@/lib/ranks";

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
  loader: () => getStats().catch(() => ({ total: 0, premium: 0, decoded: 0 })),
  component: HomePage,
});

type SearchResult = Awaited<ReturnType<typeof searchUser>>;
type HistoryEntry = { name: string; at: number; found: boolean };

const HISTORY_KEY = "userlookup_history_v1";
const HISTORY_MAX = 20;

const CHAT_CHANNELS = [
  { name: "global_chat", label: "Global chat", active: true },
  { name: "staff_room", label: "Staff room", active: false },
  { name: "dev_log", label: "Dev log", active: false },
  { name: "marketplace", label: "Marketplace", active: false },
  { name: "support", label: "Support", active: false },
] as const;

const CHAT_MESSAGES = [
  {
    id: "system",
    author: "SYSTEM",
    role: "alert",
    time: "14:02:45 UTC",
    tone: "warning" as const,
    message:
      "Rutynowy skan bezpieczeństwa zakończony. Nie wykryto anomalii logowania. Następny skan za 24h.",
  },
  {
    id: "neo",
    author: "neo_hacker99",
    role: "gracz",
    time: "14:05:12 UTC",
    tone: "neutral" as const,
    message:
      "Czy ktoś wie, kiedy planowany jest restart bazy danych? Mam kilka skryptów, które muszę zatrzymać przed tym.",
  },
  {
    id: "admin",
    author: "CyberAdmin",
    role: "admin",
    time: "14:07:30 UTC",
    tone: "accent" as const,
    message:
      "Restart zaplanowany jest na 02:00 UTC. System wyśle automatyczne powiadomienie 30 minut przed rozpoczęciem procedury na kanale #dev-log.",
  },
  {
    id: "shadow",
    author: "shadow_trader",
    role: "flagged",
    time: "14:15:00 UTC",
    tone: "danger" as const,
    message:
      "Kupię dostęp do węzłów V4. Płatność w krypto. PW.",
    note: "Wiadomość ukryta przez filtr słów kluczowych.",
  },
] as const;

const CHAT_MEMBERS = {
  administration: ["CyberAdmin"],
  moderators: ["SysWatcher", "DataGuard"],
  players: ["neo_hacker99", "pixel_queen", "user_8842", "incognito", "OskarWas013"],
} as const;

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
  const { user, canAccessAdminPanel, logout } = useAuth();
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
  const decodedPct = stats.total ? ((stats.decoded / stats.total) * 100).toFixed(1) : "0";
  const recentHistory = history.slice(0, 5);
  const onlineCount = Object.values(CHAT_MEMBERS).reduce((sum, group) => sum + group.length, 0);

  return (
    <div className="min-h-screen flex flex-col bg-[linear-gradient(180deg,color-mix(in_oklab,var(--background)_92%,black)_0%,var(--background)_100%)]">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card shadow-[var(--shadow-card)]">
              <span className="text-sm font-black text-primary">⌕</span>
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight sm:text-xl">userlookup</h1>
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">lookup terminal</p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm">
          {user ? (
            <>
              <span className="hidden items-center gap-2 text-muted-foreground sm:flex">
                <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">terminal</span>
                <span className="font-mono font-semibold text-foreground">{user.nick}</span>
                <span className="rounded-md border border-border bg-card px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                  {RANK_LABELS[user.rank]}
                </span>
                {canAccessAdminPanel && (
                  <span className="rounded-md border border-accent/30 bg-accent/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
                    panel
                  </span>
                )}
              </span>
              {canAccessAdminPanel && (
                <Link
                  to="/admin/accounts"
                  className="rounded-md border border-border bg-card px-3 py-2 text-muted-foreground transition hover:border-accent/40 hover:text-foreground"
                >
                  Panel admina
                </Link>
              )}
              <button
                onClick={() => logout()}
                className="rounded-md border border-border bg-card px-3 py-2 text-muted-foreground transition hover:text-destructive"
              >
                Wyloguj
              </button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="rounded-md border border-border bg-card px-3 py-2 text-muted-foreground transition hover:text-foreground"
              >
                Logowanie
              </Link>
              <Link
                to="/register"
                className="rounded-md border border-primary/40 bg-primary px-3 py-2 font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-90"
              >
                Rejestracja
              </Link>
            </>
          )}
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 pb-20 pt-8 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <section className="mb-8 overflow-hidden rounded-2xl border border-border bg-card/65 shadow-[var(--shadow-card)]">
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="border-b border-border/70 p-5 sm:p-8 lg:border-b-0 lg:border-r">
                <div className="mb-6 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
                  <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-primary">core lookup</span>
                  <span>nick / ip / discord / powiązania</span>
                </div>
                <h2 className="mb-3 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
                  Znajdź gracza<span className="text-primary">.</span>
                </h2>
                <p className="mb-8 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                  Wpisz nick, sprawdź premium, IP, Discord i powiązane konta w jednym terminalowym widoku.
                </p>

                {user ? (
                  <div className="max-w-3xl">
                    <form
                      onSubmit={handleSubmit}
                      className="rounded-xl border border-border bg-background/70 p-3 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--foreground)_4%,transparent)]"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row">
                        <div className="relative flex-1">
                          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">⌕</span>
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="np. Zatwardzeniuch"
                    maxLength={64}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-14 w-full rounded-lg border border-border bg-input pl-11 pr-4 text-base font-mono outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30 sm:text-lg"
                  />
                        </div>
                        <button
                          type="submit"
                          disabled={loading || !query.trim()}
                          className="h-14 rounded-lg border border-primary/30 bg-primary px-8 font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {loading ? <Spinner /> : "Szukaj"}
                        </button>
                      </div>

                      <div className="mt-3 flex items-center justify-start gap-3 text-xs">
                        <button
                          type="button"
                          onClick={() => setShowAdvanced((v) => !v)}
                          className="flex items-center gap-2 text-muted-foreground transition hover:text-foreground"
                        >
                          <span className="text-primary">{showAdvanced ? "▼" : "▶"}</span>
                          Zaawansowane opcje wyszukiwania
                        </button>
                      </div>
                    </form>

                    {showAdvanced && (
                      <div className="mt-3 rounded-xl border border-border bg-background/70 p-5 text-left text-sm shadow-[inset_0_1px_0_color-mix(in_oklab,var(--foreground)_4%,transparent)]">
                        <label className="flex cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            checked={fuzzy}
                            onChange={(e) => setFuzzy(e.target.checked)}
                            className="mt-1 h-4 w-4 accent-primary"
                          />
                          <div>
                            <div className="font-semibold">Tolerancja literówek i podobne nicki</div>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              Jeśli dokładny nick nie zostanie znaleziony, automatycznie pokażemy podobne (do 20 sugestii). Wyszukujemy w czterech trybach jednocześnie:
                            </p>
                            <ul className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
                              <li>
                                <span className="font-semibold text-foreground">• Zawiera fragment</span> — np. <code className="text-foreground">oskar</code> → <code className="text-foreground">OskarWas013</code>, <code className="text-foreground">OskarPL</code>
                              </li>
                              <li>
                                <span className="font-semibold text-foreground">• Inne cyfry na końcu</span> — np. <code className="text-foreground">OskarWas013</code> → <code className="text-foreground">OskarWas10</code>, <code className="text-foreground">OskarWas011</code>
                              </li>
                              <li>
                                <span className="font-semibold text-foreground">• Literówki (max 2 błędy)</span> — np. <code className="text-foreground">incognto</code> → <code className="text-foreground">incognito</code>
                              </li>
                              <li>
                                <span className="font-semibold text-foreground">• Brzmi podobnie (fonetycznie)</span> — np. <code className="text-foreground">Kris</code> ≈ <code className="text-foreground">Chris</code>
                              </li>
                            </ul>
                            <div className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                              💡 <strong className="text-foreground">Tip:</strong> nicki są case-insensitive. Dozwolone znaki: <code className="text-foreground">A-Z 0-9 _ . -</code>
                            </div>
                          </div>
                        </label>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="max-w-md rounded-xl border border-border bg-background/70 p-7 text-center">
                    <div className="mb-3 text-3xl">🔒</div>
                    <h3 className="mb-2 text-lg font-semibold">Dostęp tylko dla zalogowanych</h3>
                    <p className="mb-5 text-sm text-muted-foreground">Załóż darmowe konto żeby przeszukiwać bazę.</p>
                    <div className="flex justify-center gap-2">
                      <Link
                        to="/register"
                        className="rounded-lg border border-primary/40 bg-primary px-5 py-2.5 font-semibold text-primary-foreground hover:opacity-90"
                      >
                        Załóż konto
                      </Link>
                      <Link
                        to="/login"
                        className="rounded-lg border border-border px-5 py-2.5 font-semibold hover:bg-muted"
                      >
                        Zaloguj się
                      </Link>
                    </div>
                  </div>
                )}
              </div>

              <aside className="flex flex-col justify-between bg-background/55 p-5 sm:p-6">
                <div>
                  <div className="mb-5 text-[10px] uppercase tracking-[0.28em] text-muted-foreground">status publiczny</div>
                  <div className="grid gap-3">
                    <StatCard label="Konta w bazie" value={stats.total.toLocaleString("pl-PL")} />
                    <StatCard label="Premium" value={`${premiumPct}%`} sub={`${stats.premium.toLocaleString("pl-PL")} kont`} accent="success" />
                    <StatCard label="Odhashowane konta" value={stats.decoded.toLocaleString("pl-PL")} sub={`${decodedPct}% bazy`} accent="primary" />
                  </div>
                </div>

                <div className="mt-6 rounded-xl border border-border bg-card/70 p-4">
                  <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-[0.24em] text-muted-foreground">
                    <span>Ostatnie wyszukiwania</span>
                    <span>{recentHistory.length}</span>
                  </div>
                  {recentHistory.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Brak zapisanych wyszukiwań.</p>
                  ) : (
                    <ul className="space-y-2">
                      {recentHistory.map((entry) => (
                        <li key={entry.name + entry.at}>
                          <button
                            onClick={() => {
                              setQuery(entry.name);
                              runSearch(entry.name, fuzzy);
                            }}
                            className="flex w-full items-center justify-between rounded-lg border border-border bg-background/80 px-3 py-2 text-left transition hover:border-primary/30 hover:bg-muted/40"
                          >
                            <div className="min-w-0">
                              <div className="truncate font-mono text-sm text-foreground">{entry.name}</div>
                              <div className="text-[11px] text-muted-foreground">{timeAgo(entry.at)} temu</div>
                            </div>
                            <span className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${entry.found ? "border border-success/30 bg-success/10 text-success" : "border border-warning/30 bg-warning/10 text-warning"}`}>
                              {entry.found ? "znaleziono" : "brak"}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </aside>
            </div>
          </section>

          {!result && !loading && (
            <section className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <FeatureCard title="Status premium" description="Sprawdź, czy gracz posiada aktywne premium." accent="success" />
              <FeatureCard title="Powiązane konta" description="Zobacz inne konta z tego samego IP lub Discorda." accent="primary" />
              <FeatureCard title="Historia nicków" description="Łatwiej wyłapiesz zmiany nicku i alternatywne wpisy." accent="warning" />
              <FeatureCard title="Tolerancja literówek" description="Sugestie podobnych nicków nawet przy błędach i cyfrach na końcu." accent="accent" />
            </section>
          )}

          {!result && !loading && user && (
            <section className="mb-6 overflow-hidden rounded-2xl border border-border bg-card/55 shadow-[var(--shadow-card)]">
              <div className="grid min-h-[640px] lg:grid-cols-[180px_minmax(0,1fr)_280px]">
                <aside className="flex flex-col justify-between border-b border-border/70 bg-background/70 lg:border-b-0 lg:border-r">
                  <div>
                    <div className="border-b border-border/70 p-4">
                      <div className="mb-3 text-lg font-black tracking-[0.18em] text-foreground">METRIC_DB</div>
                      <div className="space-y-3 rounded-lg border border-primary/20 bg-card/80 p-3">
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">server_node_01</div>
                          <div className="mt-1 text-xs font-semibold text-warning">Status: operationaI</div>
                        </div>
                        <div className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.22em] text-warning">
                          encryption active
                        </div>
                      </div>
                    </div>

                    <nav className="p-3">
                      <div className="space-y-1">
                        {CHAT_CHANNELS.map((channel) => (
                          <button
                            key={channel.name}
                            type="button"
                            className={`flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left text-sm transition ${
                              channel.active
                                ? "border-accent/35 bg-accent/15 text-foreground shadow-[var(--shadow-glow)]"
                                : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground"
                            }`}
                          >
                            <span className="text-base">{channel.active ? "💬" : "•"}</span>
                            <div>
                              <div className="font-semibold uppercase tracking-[0.12em]">{channel.label}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </nav>
                  </div>

                  <div className="border-t border-border/70 p-3">
                    <button className="mb-2 flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-3 text-left text-sm text-muted-foreground transition hover:border-border hover:bg-muted/40 hover:text-foreground">
                      <span>⚙</span>
                      <span className="font-semibold uppercase tracking-[0.12em]">Settings</span>
                    </button>
                    <button className="flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-3 text-left text-sm text-muted-foreground transition hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive">
                      <span>↪</span>
                      <span className="font-semibold uppercase tracking-[0.12em]">Logout</span>
                    </button>
                  </div>
                </aside>

                <div className="flex min-h-[640px] flex-col bg-background/45">
                  <div className="flex items-center justify-between gap-4 border-b border-border/70 px-5 py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="text-xl font-bold text-foreground"># ogólny</span>
                        <span className="hidden text-xs text-muted-foreground sm:inline">
                          Główny kanał komunikacyjny dla wszystkich użytkowników na serwerze.
                        </span>
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-card/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      live feed
                    </div>
                  </div>

                  <div className="flex-1 space-y-4 overflow-hidden px-4 py-4 sm:px-5">
                    {CHAT_MESSAGES.map((message) => (
                      <ChatMessageCard key={message.id} message={message} />
                    ))}
                  </div>

                  <div className="border-t border-border/70 bg-card/70 px-4 py-3 sm:px-5">
                    <div className="flex items-center gap-3 rounded-xl border border-border bg-background/80 px-3 py-3">
                      <button
                        type="button"
                        className="grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:text-foreground"
                      >
                        +
                      </button>
                      <div className="flex-1 text-sm text-muted-foreground">/ wpisz wiadomość...</div>
                      <button
                        type="button"
                        className="grid h-8 w-8 place-items-center rounded-full border border-accent/30 bg-accent text-accent-foreground transition hover:opacity-90"
                      >
                        ➤
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      <span>Używaj @ do oznaczania użytkowników</span>
                      <span>Wpisz / by zobaczyć komendy</span>
                    </div>
                  </div>
                </div>

                <aside className="border-t border-border/70 bg-background/70 lg:border-l lg:border-t-0">
                  <div className="border-b border-border/70 px-5 py-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold uppercase tracking-[0.22em] text-foreground">Użytkownicy</div>
                      <div className="text-sm font-bold text-primary">{onlineCount}</div>
                    </div>
                  </div>
                  <div className="space-y-5 px-5 py-4">
                    <UsersGroup title="Administracja" count={CHAT_MEMBERS.administration.length} users={CHAT_MEMBERS.administration} tone="accent" />
                    <UsersGroup title="Moderatorzy" count={CHAT_MEMBERS.moderators.length} users={CHAT_MEMBERS.moderators} tone="warning" />
                    <UsersGroup title="Gracze" count={CHAT_MEMBERS.players.length} users={CHAT_MEMBERS.players} tone="primary" />
                  </div>
                </aside>
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
            <div className="min-w-0">
              {!result && !loading && user && false && (
                <div className="mb-6 rounded-2xl border border-dashed border-border bg-card/30 p-8 text-center text-muted-foreground">
                  <div className="mb-3 text-4xl">⌕</div>
                  <p className="text-sm">Wyniki wyszukiwania pojawią się tutaj po wpisaniu nicku.</p>
                </div>
              )}

              {loading && (
                <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card/50 py-20 text-center text-muted-foreground">
                  <Spinner large />
                  <span className="text-sm">Wyszukiwanie i analiza powiązań…</span>
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
            </div>

            {user && <aside className="hidden lg:block" />}
          </div>
        </div>
      </main>

      <footer className="border-t border-border/60 px-6 py-4 text-center text-xs text-muted-foreground">
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

function FeatureCard({
  title,
  description,
  accent,
}: {
  title: string;
  description: string;
  accent: "success" | "primary" | "warning" | "accent";
}) {
  const accentMap = {
    success: "border-success/25 bg-success/10 text-success",
    primary: "border-primary/25 bg-primary/10 text-primary",
    warning: "border-warning/25 bg-warning/10 text-warning",
    accent: "border-accent/25 bg-accent/10 text-accent",
  } as const;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-5 shadow-[var(--shadow-card)]">
      <div className={`mb-4 inline-flex rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${accentMap[accent]}`}>
        moduł
      </div>
      <h3 className="mb-2 text-lg font-semibold tracking-tight">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}

function ChatMessageCard({ message }: { message: (typeof CHAT_MESSAGES)[number] }) {
  const toneStyles = {
    warning: "border-warning/35 bg-warning/10",
    neutral: "border-border bg-card/60",
    accent: "border-accent/35 bg-accent/10",
    danger: "border-destructive/35 bg-destructive/10",
  } as const;

  const roleStyles = {
    alert: "border-warning/30 bg-warning/10 text-warning",
    gracz: "border-border bg-muted/40 text-muted-foreground",
    admin: "border-accent/30 bg-accent/15 text-accent",
    flagged: "border-destructive/30 bg-destructive/15 text-destructive",
  } as const;

  return (
    <article className={`rounded-xl border p-4 shadow-[var(--shadow-card)] ${toneStyles[message.tone]}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono font-bold text-foreground">{message.author}</span>
        <span className="text-muted-foreground">{message.time}</span>
        <span
          className={`rounded-md border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] ${roleStyles[message.role]}`}
        >
          {message.role}
        </span>
      </div>
      <p className="max-w-3xl text-sm leading-relaxed text-foreground/90">{message.message}</p>
      {message.note && <div className="mt-3 text-xs font-medium text-destructive">● {message.note}</div>}
    </article>
  );
}

function UsersGroup({
  title,
  count,
  users,
  tone,
}: {
  title: string;
  count: number;
  users: readonly string[];
  tone: "accent" | "warning" | "primary";
}) {
  const toneStyles = {
    accent: "bg-accent",
    warning: "bg-warning",
    primary: "bg-primary",
  } as const;

  return (
    <section>
      <div className="mb-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        <span>{title}</span>
        <span>·</span>
        <span>{count}</span>
      </div>
      <ul className="space-y-3">
        {users.map((username) => (
          <li key={username} className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${toneStyles[tone]}`} />
            <span className="font-mono text-sm text-foreground">{username}</span>
          </li>
        ))}
      </ul>
    </section>
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
  suggestions: Array<{ name: string; premium: boolean; matchKind?: string }>;
  fuzzyEnabled: boolean;
  onPick: (name: string) => void;
  onEnableFuzzy: () => void;
}) {
  const kindLabel = (k?: string) => {
    switch (k) {
      case "substring":
        return { text: "zawiera", className: "bg-primary/15 text-primary border-primary/30" };
      case "digit_variant":
        return { text: "inne cyfry", className: "bg-accent/30 text-accent-foreground border-accent" };
      case "typo":
        return { text: "literówka", className: "bg-warning/15 text-warning border-warning/30" };
      case "phonetic":
        return { text: "brzmi tak samo", className: "bg-muted text-muted-foreground border-border" };
      default:
        return null;
    }
  };

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
          🔍 Szukaj podobnych nicków (tolerancja literówek)
        </button>
      )}

      {suggestions.length > 0 && (
        <div className="mt-6 text-left">
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-3 text-center">
            Podobne nicki ({suggestions.length})
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            {suggestions.map((s) => {
              const kind = kindLabel(s.matchKind);
              return (
                <button
                  key={s.name}
                  onClick={() => onPick(s.name)}
                  className="px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/70 border border-border font-mono text-sm transition flex items-center gap-2"
                  title={kind?.text ? `Dopasowane: ${kind.text}` : undefined}
                >
                  {s.premium && <span className="text-success text-xs">★</span>}
                  {s.name}
                  {kind && (
                    <span
                      className={`text-[9px] uppercase tracking-wider font-sans font-semibold px-1.5 py-0.5 rounded border ${kind.className}`}
                    >
                      {kind.text}
                    </span>
                  )}
                </button>
              );
            })}
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
