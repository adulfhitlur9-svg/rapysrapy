import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { searchUser } from "@/server/users.functions";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "User Lookup — wyszukiwarka graczy" },
      {
        name: "description",
        content:
          "Szybkie wyszukiwanie graczy w bazie 1M+ rekordów. Premium, IP, Discord — wszystko w jednym miejscu.",
      },
      { property: "og:title", content: "User Lookup" },
      { property: "og:description", content: "Wyszukiwarka graczy z bazy 1M+ rekordów." },
    ],
  }),
  component: HomePage,
});

type SearchResult = Awaited<ReturnType<typeof searchUser>>;

function HomePage() {
  const { user, isAdmin, logout } = useAuth();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [submittedName, setSubmittedName] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = query.trim();
    if (!name) return;
    setLoading(true);
    setResult(null);
    setSubmittedName(name);
    try {
      const res = await searchUser({ data: { name } });
      setResult(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Błąd wyszukiwania";
      setResult({ found: false, user: null, error: msg } as SearchResult);
    } finally {
      setLoading(false);
    }
  };

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

      <main className="flex-1 flex flex-col items-center px-4 pt-16 pb-24">
        <div className="w-full max-w-2xl text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground mb-4">
            Database lookup
          </p>
          <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-3">
            Znajdź <span className="text-primary">gracza</span>.
          </h2>
          <p className="text-muted-foreground mb-10 max-w-md mx-auto">
            Wpisz nick. Sprawdź premium, IP, Discord — w mniej niż sekundę.
          </p>

          {user ? (
            <form onSubmit={handleSearch} className="flex gap-2">
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
          ) : (
            <div className="rounded-2xl border border-border bg-card/50 p-8 text-center">
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

        <div className="w-full max-w-5xl mt-12">
          {loading && (
            <div className="text-center py-20 text-muted-foreground flex flex-col items-center gap-4">
              <Spinner large />
              <span className="text-sm">Wyszukiwanie i ping IP…</span>
            </div>
          )}

          {!loading && result && !result.found && (
            <div className="rounded-2xl border border-border bg-card/50 p-10 text-center">
              <div className="text-5xl mb-3">∅</div>
              <h3 className="text-xl font-semibold mb-1">
                {result.error ? "Błąd" : "Nie znaleziono"}
              </h3>
              <p className="text-muted-foreground text-sm">
                {result.error ?? (
                  <>
                    Brak użytkownika o nicku{" "}
                    <span className="font-mono text-foreground">{submittedName}</span>.
                  </>
                )}
              </p>
            </div>
          )}

          {!loading && result?.found && result.user && <UserCard user={result.user} />}
        </div>
      </main>

      <footer className="px-6 py-4 text-center text-xs text-muted-foreground border-t border-border/50">
        userlookup · search by nickname · 1M+ records
      </footer>
    </div>
  );
}

function UserCard({ user }: { user: NonNullable<SearchResult["user"]> }) {
  const nameMcUrl = user.premium
    ? `https://pl.namemc.com/profile/${encodeURIComponent(user.name)}`
    : null;
  const headUrl = user.premium
    ? `https://mc-heads.net/avatar/${encodeURIComponent(user.name)}/64`
    : null;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-[var(--shadow-card)] overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="px-6 py-5 border-b border-border flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-4">
          {headUrl && (
            <img
              src={headUrl}
              alt={`Głowka gracza ${user.name}`}
              width={48}
              height={48}
              loading="lazy"
              className="h-12 w-12 rounded-md border border-border bg-muted shrink-0 [image-rendering:pixelated]"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
              Nickname
            </div>
            <div className="text-2xl font-bold font-mono">{user.name}</div>
          </div>
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
              Zobacz profil NameMC ↗
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
