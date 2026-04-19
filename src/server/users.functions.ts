import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ---------- Search ----------
const searchSchema = z.object({
  name: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.\-]+$/, "Niedozwolone znaki"),
});

export const searchUser = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => searchSchema.parse(input))
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("users")
      .select("name, password, first_ip, last_ip, premium, discord_email")
      .ilike("name", data.name)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("searchUser error", error);
      return { found: false as const, user: null, error: "Błąd zapytania do bazy" };
    }
    if (!row) return { found: false as const, user: null, error: null };

    const [firstIpStatus, lastIpStatus] = await Promise.all([
      checkIpStatus(row.first_ip),
      checkIpStatus(row.last_ip),
    ]);

    return {
      found: true as const,
      error: null,
      user: {
        name: row.name,
        password: row.password,
        firstIP: row.first_ip,
        lastIP: row.last_ip,
        premium: !!row.premium,
        discordEmail: row.discord_email,
        firstIpStatus,
        lastIpStatus,
      },
    };
  });

async function checkIpStatus(ip: string | null): Promise<"reachable" | "not reachable" | "unknown"> {
  if (!ip) return "unknown";
  // Walidacja IPv4
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return "unknown";
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p < 0 || p > 255)) return "unknown";

  // Cloudflare Workers nie obsługują ICMP. Próbujemy HTTP HEAD na portach 80/443.
  // Brak odpowiedzi != offline, ale to najlepsze co możemy zrobić w runtime edge.
  const tryFetch = async (url: string) => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch(url, { method: "HEAD", signal: ctrl.signal, redirect: "manual" });
      clearTimeout(t);
      // Jakakolwiek odpowiedź HTTP = host żyje
      return res.status >= 0;
    } catch {
      return false;
    }
  };

  const ok = (await tryFetch(`http://${ip}`)) || (await tryFetch(`https://${ip}`));
  return ok ? "reachable" : "not reachable";
}

// ---------- Bulk import ----------
const recordSchema = z.object({
  name: z.string().min(1).max(64),
  authorization: z
    .object({
      password: z.string().nullish(),
      firstIP: z.string().nullish(),
      lastIP: z.string().nullish(),
      premium: z.boolean().nullish(),
    })
    .nullish(),
  connectedAccounts: z
    .object({
      discordEmail: z.string().nullish(),
    })
    .nullish(),
});

const importSchema = z.object({
  records: z.array(z.unknown()).min(1).max(2000),
});

export const bulkImport = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => importSchema.parse(input))
  .handler(async ({ data }) => {
    const rows: Array<{
      name: string;
      password: string | null;
      first_ip: string | null;
      last_ip: string | null;
      premium: boolean;
      discord_email: string | null;
    }> = [];

    let skipped = 0;
    for (const raw of data.records) {
      const parsed = recordSchema.safeParse(raw);
      if (!parsed.success) {
        skipped++;
        continue;
      }
      const r = parsed.data;
      rows.push({
        name: r.name,
        password: r.authorization?.password ?? null,
        first_ip: r.authorization?.firstIP ?? null,
        last_ip: r.authorization?.lastIP ?? null,
        premium: !!r.authorization?.premium,
        discord_email: r.connectedAccounts?.discordEmail ?? null,
      });
    }

    if (rows.length === 0) {
      return { inserted: 0, skipped, error: null };
    }

    const { error, count } = await supabaseAdmin
      .from("users")
      .upsert(rows, { onConflict: "name_lower", ignoreDuplicates: true, count: "exact" });

    if (error) {
      console.error("bulkImport error", error);
      return { inserted: 0, skipped, error: error.message };
    }
    return { inserted: count ?? rows.length, skipped, error: null };
  });

// ---------- Stats ----------
export const getStats = createServerFn({ method: "GET" }).handler(async () => {
  const { count } = await supabaseAdmin
    .from("users")
    .select("*", { count: "exact", head: true });
  return { total: count ?? 0 };
});
