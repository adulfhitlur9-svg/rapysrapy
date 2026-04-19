import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Logowanie — userlookup" },
      { name: "description", content: "Zaloguj się aby korzystać z wyszukiwarki." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [nick, setNick] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await login(nick, password);
      if (r.ok) {
        navigate({ to: "/" });
      } else {
        setError(r.error ?? "Błąd logowania");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Błąd");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-8"
      >
        <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
          ← powrót
        </Link>
        <h1 className="text-2xl font-bold mt-3 mb-1">Logowanie</h1>
        <p className="text-sm text-muted-foreground mb-6">Zaloguj się do swojego konta.</p>

        <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">Nick</label>
        <input
          type="text"
          required
          autoComplete="username"
          autoFocus
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          className="w-full mb-3 px-4 py-3 rounded-xl border border-border bg-background font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />

        <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">Hasło</label>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border border-border bg-background font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />

        {error && <div className="mt-3 text-sm text-destructive">{error}</div>}

        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50 hover:opacity-90 transition"
        >
          {busy ? "Loguję…" : "Zaloguj"}
        </button>

        <div className="mt-4 text-center text-xs text-muted-foreground">
          Nie masz konta?{" "}
          <Link to="/register" className="text-primary hover:underline">
            Zarejestruj się
          </Link>
        </div>
      </form>
    </div>
  );
}
