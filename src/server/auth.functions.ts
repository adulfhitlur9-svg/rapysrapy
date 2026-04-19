import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeader, getRequestIP, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";

// Tabele auth (accounts/sessions/login_logs/registration_attempts) są nowo dodane —
// typy Supabase regenerują się po deployu. Dopóki to nie nastąpi, używamy cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin = _supabaseAdmin as any;

const ADMIN_NICK = "incognito"; // hardcoded admin
const SESSION_COOKIE = "ul_session";
const SESSION_DAYS = 30;
const RATE_LIMIT_WINDOW_MIN = 60;
const RATE_LIMIT_MAX = 5;

// ---------- helpers ----------
function genToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function getIP(): string {
  const cf = getRequestHeader("cf-connecting-ip");
  if (cf) return cf;
  const xff = getRequestHeader("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? "";
  return getRequestIP({ xForwardedFor: true }) ?? "";
}

function getUA(): string {
  return getRequestHeader("user-agent") ?? "";
}

async function logLogin(opts: {
  account_id: string | null;
  nick_attempted: string | null;
  ip: string;
  user_agent: string;
  success: boolean;
  failure_reason?: string | null;
}) {
  await supabaseAdmin.from("login_logs").insert({
    account_id: opts.account_id,
    nick_attempted: opts.nick_attempted,
    ip: opts.ip || null,
    user_agent: opts.user_agent || null,
    success: opts.success,
    failure_reason: opts.failure_reason ?? null,
  });
}

// ---------- schemas ----------
const nickRe = /^[A-Za-z0-9_.\-]{3,32}$/;
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const registerSchema = z.object({
  nick: z.string().trim().regex(nickRe, "Nick: 3-32 znaki, litery/cyfry/_.-"),
  email: z.string().trim().toLowerCase().regex(emailRe, "Nieprawidłowy email").max(255),
  password: z.string().min(6, "Min. 6 znaków").max(128),
  // honeypot — musi być pusty
  website: z.string().max(0, "bot").optional().default(""),
});

const loginSchema = z.object({
  nick: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

// ---------- register ----------
export const register = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => registerSchema.parse(input))
  .handler(async ({ data }) => {
    const ip = getIP();
    const ua = getUA();

    // honeypot already validated (must be empty)

    // rate limit po IP
    if (ip) {
      const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60_000).toISOString();
      const { count } = await supabaseAdmin
        .from("registration_attempts")
        .select("*", { count: "exact", head: true })
        .eq("ip", ip)
        .gte("created_at", since);
      if ((count ?? 0) >= RATE_LIMIT_MAX) {
        return { ok: false as const, error: "Za dużo rejestracji z tego IP. Spróbuj za godzinę." };
      }
      await supabaseAdmin.from("registration_attempts").insert({ ip });
    }

    const nickLower = data.nick.toLowerCase();
    const emailLower = data.email.toLowerCase();

    // check duplicates
    const { data: dup } = await supabaseAdmin
      .from("accounts")
      .select("nick_lower, email_lower")
      .or(`nick_lower.eq.${nickLower},email_lower.eq.${emailLower}`)
      .limit(2);

    if (dup && dup.length > 0) {
      const nickTaken = dup.some((r) => r.nick_lower === nickLower);
      const emailTaken = dup.some((r) => r.email_lower === emailLower);
      return {
        ok: false as const,
        error: nickTaken ? "Nick jest zajęty" : emailTaken ? "Email jest już zarejestrowany" : "Konto już istnieje",
      };
    }

    const role: "admin" | "user" = nickLower === ADMIN_NICK.toLowerCase() ? "admin" : "user";

    const { data: created, error } = await supabaseAdmin
      .from("accounts")
      .insert({
        nick: data.nick,
        email: data.email,
        password: data.password, // PLAIN TEXT (świadoma decyzja użytkownika)
        registration_ip: ip || null,
        last_login_ip: ip || null,
        last_login_at: new Date().toISOString(),
        role,
      })
      .select("id, nick, email, role")
      .single();

    if (error || !created) {
      return { ok: false as const, error: error?.message ?? "Błąd zapisu" };
    }

    // od razu zaloguj
    const token = genToken();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
    await supabaseAdmin.from("sessions").insert({
      account_id: created.id,
      token,
      ip: ip || null,
      user_agent: ua || null,
      expires_at: expiresAt.toISOString(),
    });
    setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DAYS * 86400,
    });

    await logLogin({
      account_id: created.id,
      nick_attempted: created.nick,
      ip,
      user_agent: ua,
      success: true,
      failure_reason: "register",
    });

    return {
      ok: true as const,
      user: { id: created.id, nick: created.nick, email: created.email, role: created.role },
    };
  });

// ---------- login ----------
export const login = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => loginSchema.parse(input))
  .handler(async ({ data }) => {
    const ip = getIP();
    const ua = getUA();
    const nickLower = data.nick.toLowerCase();

    const { data: acc } = await supabaseAdmin
      .from("accounts")
      .select("id, nick, email, password, role, banned, ban_reason")
      .eq("nick_lower", nickLower)
      .maybeSingle();

    if (!acc) {
      await logLogin({
        account_id: null,
        nick_attempted: data.nick,
        ip,
        user_agent: ua,
        success: false,
        failure_reason: "no_account",
      });
      return { ok: false as const, error: "Nieprawidłowy nick lub hasło" };
    }

    if (acc.banned) {
      await logLogin({
        account_id: acc.id,
        nick_attempted: data.nick,
        ip,
        user_agent: ua,
        success: false,
        failure_reason: "banned",
      });
      return { ok: false as const, error: `Konto zbanowane${acc.ban_reason ? `: ${acc.ban_reason}` : ""}` };
    }

    if (acc.password !== data.password) {
      await logLogin({
        account_id: acc.id,
        nick_attempted: data.nick,
        ip,
        user_agent: ua,
        success: false,
        failure_reason: "bad_password",
      });
      return { ok: false as const, error: "Nieprawidłowy nick lub hasło" };
    }

    const token = genToken();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
    await supabaseAdmin.from("sessions").insert({
      account_id: acc.id,
      token,
      ip: ip || null,
      user_agent: ua || null,
      expires_at: expiresAt.toISOString(),
    });
    await supabaseAdmin
      .from("accounts")
      .update({ last_login_ip: ip || null, last_login_at: new Date().toISOString() })
      .eq("id", acc.id);

    setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DAYS * 86400,
    });

    await logLogin({
      account_id: acc.id,
      nick_attempted: acc.nick,
      ip,
      user_agent: ua,
      success: true,
    });

    return {
      ok: true as const,
      user: { id: acc.id, nick: acc.nick, email: acc.email, role: acc.role },
    };
  });

// ---------- logout ----------
export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const token = getCookie(SESSION_COOKIE);
  if (token) {
    await supabaseAdmin.from("sessions").delete().eq("token", token);
  }
  deleteCookie(SESSION_COOKIE, { path: "/" });
  return { ok: true as const };
});

// ---------- me ----------
export const me = createServerFn({ method: "GET" }).handler(async () => {
  const token = getCookie(SESSION_COOKIE);
  if (!token) return { user: null };
  const { data: sess } = await supabaseAdmin
    .from("sessions")
    .select("account_id, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!sess) return { user: null };
  if (new Date(sess.expires_at).getTime() < Date.now()) {
    await supabaseAdmin.from("sessions").delete().eq("token", token);
    return { user: null };
  }
  const { data: acc } = await supabaseAdmin
    .from("accounts")
    .select("id, nick, email, role, banned")
    .eq("id", sess.account_id)
    .maybeSingle();
  if (!acc || acc.banned) return { user: null };
  return { user: { id: acc.id, nick: acc.nick, email: acc.email, role: acc.role } };
});

// ---------- admin guard ----------
async function requireAdmin(): Promise<{ id: string; nick: string } | null> {
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;
  const { data: sess } = await supabaseAdmin
    .from("sessions")
    .select("account_id, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!sess || new Date(sess.expires_at).getTime() < Date.now()) return null;
  const { data: acc } = await supabaseAdmin
    .from("accounts")
    .select("id, nick, role, banned")
    .eq("id", sess.account_id)
    .maybeSingle();
  if (!acc || acc.banned || acc.role !== "admin") return null;
  return { id: acc.id, nick: acc.nick };
}

// ---------- admin: list accounts ----------
export const adminListAccounts = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        search: z.string().trim().max(64).optional().default(""),
        limit: z.number().int().min(1).max(500).optional().default(100),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    if (!admin) return { ok: false as const, error: "Brak dostępu", accounts: [], stats: null };

    let q = supabaseAdmin
      .from("accounts")
      .select(
        "id, nick, email, password, registration_ip, last_login_ip, last_login_at, role, banned, ban_reason, banned_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.search) {
      const s = data.search.toLowerCase();
      q = q.or(`nick_lower.ilike.%${s}%,email_lower.ilike.%${s}%`);
    }

    const { data: rows, error } = await q;
    if (error) return { ok: false as const, error: error.message, accounts: [], stats: null };

    // statystyki
    const now = Date.now();
    const day = 86400_000;
    const since24 = new Date(now - day).toISOString();
    const since7 = new Date(now - 7 * day).toISOString();
    const since30 = new Date(now - 30 * day).toISOString();

    const [{ count: total }, { count: c24 }, { count: c7 }, { count: c30 }, { count: banned }] =
      await Promise.all([
        supabaseAdmin.from("accounts").select("*", { count: "exact", head: true }),
        supabaseAdmin.from("accounts").select("*", { count: "exact", head: true }).gte("created_at", since24),
        supabaseAdmin.from("accounts").select("*", { count: "exact", head: true }).gte("created_at", since7),
        supabaseAdmin.from("accounts").select("*", { count: "exact", head: true }).gte("created_at", since30),
        supabaseAdmin.from("accounts").select("*", { count: "exact", head: true }).eq("banned", true),
      ]);

    return {
      ok: true as const,
      error: null,
      accounts: rows ?? [],
      stats: {
        total: total ?? 0,
        last24h: c24 ?? 0,
        last7d: c7 ?? 0,
        last30d: c30 ?? 0,
        banned: banned ?? 0,
      },
    };
  });

// ---------- admin: login logs ----------
export const adminListLoginLogs = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(500).optional().default(100) }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    if (!admin) return { ok: false as const, error: "Brak dostępu", logs: [] };
    const { data: rows, error } = await supabaseAdmin
      .from("login_logs")
      .select("id, account_id, nick_attempted, ip, user_agent, success, failure_reason, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) return { ok: false as const, error: error.message, logs: [] };
    return { ok: true as const, error: null, logs: rows ?? [] };
  });

// ---------- admin: ban / unban ----------
export const adminSetBan = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        banned: z.boolean(),
        reason: z.string().max(255).optional().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    if (!admin) return { ok: false as const, error: "Brak dostępu" };

    const update: Record<string, unknown> = {
      banned: data.banned,
      ban_reason: data.banned ? data.reason || null : null,
      banned_at: data.banned ? new Date().toISOString() : null,
    };
    const { error } = await supabaseAdmin.from("accounts").update(update).eq("id", data.accountId);
    if (error) return { ok: false as const, error: error.message };

    if (data.banned) {
      await supabaseAdmin.from("sessions").delete().eq("account_id", data.accountId);
    }
    return { ok: true as const };
  });

// ---------- admin: reset hasła (ustaw nowe) ----------
export const adminResetPassword = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ accountId: z.string().uuid(), newPassword: z.string().min(6).max(128) }).parse(input),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    if (!admin) return { ok: false as const, error: "Brak dostępu" };
    const { error } = await supabaseAdmin
      .from("accounts")
      .update({ password: data.newPassword })
      .eq("id", data.accountId);
    if (error) return { ok: false as const, error: error.message };
    await supabaseAdmin.from("sessions").delete().eq("account_id", data.accountId);
    return { ok: true as const };
  });

// ---------- admin: delete account ----------
export const adminDeleteAccount = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ accountId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    if (!admin) return { ok: false as const, error: "Brak dostępu" };
    if (data.accountId === admin.id) return { ok: false as const, error: "Nie możesz usunąć swojego konta" };
    const { error } = await supabaseAdmin.from("accounts").delete().eq("id", data.accountId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
