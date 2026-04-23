import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  adminListAccounts,
  adminListLoginLogs,
  adminSetBan,
  adminResetPassword,
  adminDeleteAccount,
} from "@/server/auth.functions";
import { HashesTab } from "@/components/admin/HashesTab";
import { useAuth } from "@/lib/auth-context";
import { RANK_LABELS, type AccountRank } from "@/lib/ranks";

export const Route = createFileRoute("/_authenticated/_admin/admin/accounts")({
  head: () => ({
    meta: [
      { title: "Panel admina — konta" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminAccountsPage,
});

type Account = {
  id: string;
  nick: string;
  email: string;
  password: string;
  registration_ip: string | null;
  last_login_ip: string | null;
  last_login_at: string | null;
  role: "user" | "admin";
  rank: AccountRank;
  banned: boolean;
  ban_reason: string | null;
  banned_at: string | null;
  created_at: string;
};

type Stats = {
  total: number;
  last24h: number;
  last7d: number;
  last30d: number;
  banned: number;
};

type LoginLog = {
  id: number;
  account_id: string | null;
  nick_attempted: string | null;
  ip: string | null;
  user_agent: string | null;
  success: boolean;
  failure_reason: string | null;
  created_at: string;
};

function AdminAccountsPage() {
  const { user, logout } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [logs, setLogs] = useState<LoginLog[]>([]);
  const [search, setSearch] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [tab, setTab] = useState<"accounts" | "logs" | "hashes">("accounts");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setBusy(true);
    setError(null);
    try {
      const [a, l] = await Promise.all([
        adminListAccounts({ data: { search, limit: 200 } }),
        adminListLoginLogs({ data: { limit: 200 } }),
      ]);
      if (a.ok) {
        setAccounts(a.accounts as Account[]);
        setStats(a.stats);
      } else {
        setError(a.error);
      }
      if (l.ok) setLogs(l.logs as LoginLog[]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const handleBan = async (acc: Account) => {
    if (acc.banned) {
      if (!confirm(`Odbanować ${acc.nick}?`)) return;
      const r = await adminSetBan({ data: { accountId: acc.id, banned: false, reason: "" } });
      if (!r.ok) return alert(r.error);
    } else {
      const reason = prompt(`Powód bana dla ${acc.nick}:`, "spam");
      if (reason === null) return;
      const r = await adminSetBan({ data: { accountId: acc.id, banned: true, reason } });
      if (!r.ok) return alert(r.error);
    }
    await reload();
  };

  const handleReset = async (acc: Account) => {
    const np = prompt(`Nowe hasło dla ${acc.nick} (min. 6 znaków):`, "");
    if (!np || np.length < 6) return alert("Hasło musi mieć min. 6 znaków");
    const r = await adminResetPassword({ data: { accountId: acc.id, newPassword: np } });
    if (!r.ok) return alert(r.error);
    alert("Hasło zmienione. Wszystkie sesje wylogowane.");
    await reload();
  };

  const handleDelete = async (acc: Account) => {
    if (!confirm(`USUNĄĆ konto ${acc.nick}? Tej operacji nie da się cofnąć.`)) return;
    const r = await adminDeleteAccount({ data: { accountId: acc.id } });
    if (!r.ok) return alert(r.error);
    await reload();
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
              <h1 className="text-lg font-bold tracking-tight sm:text-xl">panel administracyjny</h1>
              <p className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">lookup terminal</p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-sm">
            {user && (
              <span className="hidden items-center gap-2 text-muted-foreground lg:flex">
                <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">operator</span>
                <span className="font-mono font-semibold text-foreground">{user.nick}</span>
                <span className="rounded-md border border-border bg-card px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                  {RANK_LABELS[user.rank]}
                </span>
              </span>
            )}
            <Link
              to="/"
              className="rounded-md border border-border bg-card px-3 py-2 text-muted-foreground transition hover:border-accent/40 hover:text-foreground"
            >
              Strona główna
            </Link>
            <Link
              to="/admin/import"
              className="rounded-md border border-border bg-card px-3 py-2 text-muted-foreground transition hover:border-accent/40 hover:text-foreground"
            >
              Import danych
            </Link>
            <button
              onClick={() => logout()}
              className="rounded-md border border-border bg-card px-3 py-2 text-muted-foreground transition hover:text-destructive"
            >
              Wyloguj
            </button>
          </div>
        </div>
      </header>

      <main className="px-4 pb-16 pt-8 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <section className="mb-6 overflow-hidden rounded-2xl border border-border bg-card/65 shadow-[var(--shadow-card)]">
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="border-b border-border/70 p-5 sm:p-8 lg:border-b-0 lg:border-r">
                <div className="mb-6 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
                  <span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-primary">control center</span>
                  <span>konta / logi / hashe</span>
                </div>
                <h2 className="mb-3 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
                  Zarządzaj systemem<span className="text-primary">.</span>
                </h2>
                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                  Jeden widok do zarządzania kontami, monitorowania logowań i obsługi odzyskanych haseł.
                </p>
              </div>

              <aside className="bg-background/55 p-5 sm:p-6">
                {stats ? (
                  <div className="grid gap-3">
                    <AdminStatCard label="Wszystkie konta" value={stats.total} />
                    <AdminStatCard label="Ostatnie 24h" value={stats.last24h} accent="primary" />
                    <AdminStatCard label="Ostatnie 7 dni" value={stats.last7d} />
                    <AdminStatCard label="Ostatnie 30 dni" value={stats.last30d} />
                    <AdminStatCard label="Zbanowane" value={stats.banned} accent="danger" />
                  </div>
                ) : (
                  <div className="rounded-xl border border-border bg-card/50 p-4 text-sm text-muted-foreground">
                    Ładowanie statystyk…
                  </div>
                )}
              </aside>
            </div>
          </section>

          <section className="mb-6 flex flex-wrap gap-3">
            <AdminTabButton active={tab === "accounts"} onClick={() => setTab("accounts")}>
              Konta <span className="text-muted-foreground">({accounts.length})</span>
            </AdminTabButton>
            <AdminTabButton active={tab === "logs"} onClick={() => setTab("logs")}>
              Logi <span className="text-muted-foreground">({logs.length})</span>
            </AdminTabButton>
            <AdminTabButton active={tab === "hashes"} onClick={() => setTab("hashes")}>
              Hashe
            </AdminTabButton>
          </section>

          {tab === "accounts" && (
            <section className="rounded-2xl border border-border bg-card/60 p-5 shadow-[var(--shadow-card)] sm:p-6">
              <div className="mb-5 flex flex-wrap items-center gap-3">
                <div className="relative min-w-[220px] flex-1">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">⌕</span>
                  <input
                    type="text"
                    placeholder="Szukaj po nicku lub mailu…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && reload()}
                    className="h-12 w-full rounded-lg border border-border bg-input pl-11 pr-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <button
                  onClick={reload}
                  disabled={busy}
                  className="h-12 rounded-lg border border-primary/30 bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? "Ładowanie…" : "Odśwież"}
                </button>
                <label className="flex h-12 items-center gap-3 rounded-lg border border-border bg-background/60 px-4 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={showPasswords}
                    onChange={(e) => setShowPasswords(e.target.checked)}
                    className="h-4 w-4 accent-[var(--color-primary)]"
                  />
                  Pokaż hasła
                </label>
              </div>

              {error && (
                <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="overflow-x-auto rounded-2xl border border-border bg-background/45">
                <table className="w-full min-w-[1120px] text-sm">
                  <thead className="bg-muted/30 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left">Konto</th>
                      <th className="px-4 py-3 text-left">Email</th>
                      <th className="px-4 py-3 text-left">Hasło</th>
                      <th className="px-4 py-3 text-left">Reg. IP</th>
                      <th className="px-4 py-3 text-left">Ostatnie IP</th>
                      <th className="px-4 py-3 text-left">Utworzono</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-right">Akcje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.map((a) => (
                      <tr key={a.id} className="border-t border-border/80 transition hover:bg-muted/20">
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono font-semibold text-foreground">{a.nick}</span>
                              <span className="rounded-md border border-border bg-card px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                                {RANK_LABELS[a.rank]}
                              </span>
                              {a.role === "admin" && (
                                <span className="rounded-md border border-accent/30 bg-accent/15 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
                                  legacy admin
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">logowanie: {a.last_login_at ? new Date(a.last_login_at).toLocaleString() : "—"}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{a.email}</td>
                        <td className="px-4 py-3 font-mono text-xs text-foreground">{showPasswords ? a.password : "••••••••"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{a.registration_ip ?? "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{a.last_login_ip ?? "—"}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</td>
                        <td className="px-4 py-3">
                          {a.banned ? (
                            <span className="inline-flex rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-destructive">
                              ban{a.ban_reason ? ` · ${a.ban_reason}` : ""}
                            </span>
                          ) : (
                            <span className="inline-flex rounded-md border border-success/30 bg-success/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-success">
                              aktywne
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <ActionButton onClick={() => handleBan(a)} variant={a.banned ? "success" : "danger"}>
                              {a.banned ? "Unban" : "Ban"}
                            </ActionButton>
                            <ActionButton onClick={() => handleReset(a)}>Reset hasła</ActionButton>
                            <ActionButton onClick={() => handleDelete(a)} variant="danger">
                              Usuń
                            </ActionButton>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {accounts.length === 0 && !busy && (
                      <tr>
                        <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                          Brak kont dla podanego filtra.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {tab === "logs" && (
            <section className="rounded-2xl border border-border bg-card/60 p-5 shadow-[var(--shadow-card)] sm:p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold tracking-tight">Logi logowań</h3>
                  <p className="text-sm text-muted-foreground">Ostatnie próby logowania i ich wynik.</p>
                </div>
                <button
                  onClick={reload}
                  disabled={busy}
                  className="rounded-lg border border-border bg-background/60 px-4 py-2 text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                >
                  {busy ? "Odświeżanie…" : "Odśwież"}
                </button>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-border bg-background/45">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-muted/30 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left">Data</th>
                      <th className="px-4 py-3 text-left">Nick</th>
                      <th className="px-4 py-3 text-left">IP</th>
                      <th className="px-4 py-3 text-left">Wynik</th>
                      <th className="px-4 py-3 text-left">User-Agent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((l) => (
                      <tr key={l.id} className="border-t border-border/80 transition hover:bg-muted/20">
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                        <td className="px-4 py-3 font-mono text-sm">{l.nick_attempted ?? "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{l.ip ?? "—"}</td>
                        <td className="px-4 py-3">
                          {l.success ? (
                            <span className="inline-flex rounded-md border border-success/30 bg-success/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-success">
                              ok{l.failure_reason ? ` · ${l.failure_reason}` : ""}
                            </span>
                          ) : (
                            <span className="inline-flex rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-destructive">
                              fail{l.failure_reason ? ` · ${l.failure_reason}` : ""}
                            </span>
                          )}
                        </td>
                        <td className="max-w-xs px-4 py-3 text-xs text-muted-foreground">{l.user_agent ?? "—"}</td>
                      </tr>
                    ))}
                    {logs.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-12 text-center text-sm text-muted-foreground">
                          Brak logów.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {tab === "hashes" && (
            <section className="rounded-2xl border border-border bg-card/60 p-5 shadow-[var(--shadow-card)] sm:p-6">
              <HashesTab />
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

function AdminTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-4 py-2.5 text-sm font-semibold transition ${
        active
          ? "border-primary/30 bg-primary/10 text-foreground shadow-[var(--shadow-glow)]"
          : "border-border bg-card/50 text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function AdminStatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "primary" | "danger";
}) {
  const tone =
    accent === "danger"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : accent === "primary"
        ? "border-primary/30 bg-primary/10 text-primary"
        : "border-border bg-card/50 text-foreground";

  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className="mb-1 text-[10px] uppercase tracking-[0.24em] text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold font-mono">{value.toLocaleString()}</div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "danger" | "success";
}) {
  const tone =
    variant === "danger"
      ? "border-destructive/30 text-destructive hover:bg-destructive/10"
      : variant === "success"
        ? "border-success/30 text-success hover:bg-success/10"
        : "border-border text-muted-foreground hover:bg-muted/30 hover:text-foreground";

  return (
    <button onClick={onClick} className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${tone}`}>
      {children}
    </button>
  );
}
