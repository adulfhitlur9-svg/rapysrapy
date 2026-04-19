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
      } else setError(a.error);
      if (l.ok) setLogs(l.logs as LoginLog[]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div className="min-h-screen px-4 py-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← powrót
          </Link>
          <div className="flex gap-2">
            <Link
              to="/admin/import"
              className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted"
            >
              Import danych
            </Link>
          </div>
        </div>

        <h1 className="text-3xl font-bold mb-2">Panel admina</h1>
        <p className="text-muted-foreground mb-6">Konta użytkowników, audit log, statystyki.</p>

        {/* statystyki */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <StatCard label="Wszystkie konta" value={stats.total} />
            <StatCard label="Ostatnie 24h" value={stats.last24h} accent />
            <StatCard label="Ostatnie 7 dni" value={stats.last7d} />
            <StatCard label="Ostatnie 30 dni" value={stats.last30d} />
            <StatCard label="Zbanowane" value={stats.banned} danger />
          </div>
        )}

        {/* taby */}
        <div className="flex gap-2 mb-4 border-b border-border">
          <button
            onClick={() => setTab("accounts")}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${
              tab === "accounts"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Konta ({accounts.length})
          </button>
          <button
            onClick={() => setTab("logs")}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${
              tab === "logs"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Logi logowań ({logs.length})
          </button>
          <button
            onClick={() => setTab("hashes")}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${
              tab === "hashes"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Hashe haseł
          </button>
        </div>

        {tab === "accounts" && (
          <>
            <div className="flex flex-wrap gap-3 mb-4 items-center">
              <input
                type="text"
                placeholder="Szukaj po nicku lub mailu…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && reload()}
                className="flex-1 min-w-[200px] px-4 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                onClick={reload}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50"
              >
                Szukaj
              </button>
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPasswords}
                  onChange={(e) => setShowPasswords(e.target.checked)}
                />
                pokaż hasła
              </label>
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
                    <th className="px-3 py-3 text-left">Nick</th>
                    <th className="px-3 py-3 text-left">Email</th>
                    <th className="px-3 py-3 text-left">Hasło</th>
                    <th className="px-3 py-3 text-left">Reg. IP</th>
                    <th className="px-3 py-3 text-left">Ostatnie IP</th>
                    <th className="px-3 py-3 text-left">Utworzono</th>
                    <th className="px-3 py-3 text-left">Status</th>
                    <th className="px-3 py-3 text-right">Akcje</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id} className="border-t border-border hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono font-semibold">
                        {a.nick}
                        {a.role === "admin" && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                            ADMIN
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{a.email}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {showPasswords ? a.password : "••••••••"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{a.registration_ip ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{a.last_login_ip ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {new Date(a.created_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        {a.banned ? (
                          <span className="text-xs px-2 py-0.5 rounded bg-destructive/20 text-destructive">
                            BAN{a.ban_reason ? `: ${a.ban_reason}` : ""}
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded bg-success/20 text-success">
                            OK
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          onClick={() => handleBan(a)}
                          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted mr-1"
                        >
                          {a.banned ? "Unban" : "Ban"}
                        </button>
                        <button
                          onClick={() => handleReset(a)}
                          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted mr-1"
                        >
                          Reset hasła
                        </button>
                        <button
                          onClick={() => handleDelete(a)}
                          className="text-xs px-2 py-1 rounded border border-destructive/40 text-destructive hover:bg-destructive/10"
                        >
                          Usuń
                        </button>
                      </td>
                    </tr>
                  ))}
                  {accounts.length === 0 && !busy && (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                        Brak kont
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "logs" && (
          <div className="rounded-2xl border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-3 text-left">Data</th>
                  <th className="px-3 py-3 text-left">Nick</th>
                  <th className="px-3 py-3 text-left">IP</th>
                  <th className="px-3 py-3 text-left">Wynik</th>
                  <th className="px-3 py-3 text-left">User-Agent</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t border-border hover:bg-muted/20">
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(l.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono">{l.nick_attempted ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{l.ip ?? "—"}</td>
                    <td className="px-3 py-2">
                      {l.success ? (
                        <span className="text-xs px-2 py-0.5 rounded bg-success/20 text-success">
                          OK{l.failure_reason ? ` (${l.failure_reason})` : ""}
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded bg-destructive/20 text-destructive">
                          FAIL{l.failure_reason ? `: ${l.failure_reason}` : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-xs">
                      {l.user_agent ?? "—"}
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                      Brak logów
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === "hashes" && <HashesTab />}
      </div>
    </div>
  );
}

function StatCard({
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
          ? "border-destructive/30 bg-destructive/5"
          : accent
            ? "border-primary/30 bg-primary/5"
            : "border-border bg-card"
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={`text-2xl font-bold font-mono mt-1 ${
          danger ? "text-destructive" : accent ? "text-primary" : ""
        }`}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}
