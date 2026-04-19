import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Rejestracja — userlookup" },
      { name: "description", content: "Załóż konto żeby uzyskać dostęp do wyszukiwarki." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [nick, setNick] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await register(nick, email, password, website);
      if (r.ok) {
        navigate({ to: "/" });
      } else {
        setError(r.error ?? "Nie udało się zarejestrować");
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
        <h1 className="text-2xl font-bold mt-3 mb-1">Rejestracja</h1>
        <p className="text-sm text-muted-foreground mb-6">Załóż konto aby korzystać z wyszukiwarki.</p>

        {/* honeypot */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
          aria-hidden="true"
        />

        <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">Nick</label>
        <input
          type="text"
          required
          minLength={3}
          maxLength={32}
          autoComplete="username"
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          className="w-full mb-3 px-4 py-3 rounded-xl border border-border bg-background font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="np. Zatwardzeniuch"
        />

        <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">Email</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-3 px-4 py-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="ty@example.com"
        />

        <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">Hasło</label>
        <input
          type="password"
          required
          minLength={6}
          maxLength={128}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border border-border bg-background font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="min. 6 znaków"
        />

        {error && <div className="mt-3 text-sm text-destructive">{error}</div>}

        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50 hover:opacity-90 transition"
        >
          {busy ? "Tworzę…" : "Załóż konto"}
        </button>

        <div className="mt-4 text-center text-xs text-muted-foreground">
          Masz już konto?{" "}
          <Link to="/login" className="text-primary hover:underline">
            Zaloguj się
          </Link>
        </div>
      </form>
    </div>
  );
}
