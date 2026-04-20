import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin as _supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseAdmin = _supabaseAdmin as any;
const SESSION_COOKIE = "ul_session";

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

// ---------- list hashes (top by count, paginated) ----------
export const adminListHashes = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        page: z.number().int().min(1).max(10000).optional().default(1),
        pageSize: z.number().int().min(10).max(500).optional().default(100),
        onlyUncracked: z.boolean().optional().default(false),
        search: z.string().trim().max(128).optional().default(""),
      })
      .parse(input)
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    if (!admin) return { ok: false as const, error: "Brak dostępu" };

    // Pobierz pełną listę hashy z liczbą wystąpień (z indeksem to szybkie nawet dla 100k+)
    // Robimy raw SQL via RPC nie mamy — używamy klienta z group by przez select+agregat fallback:
    // Supabase JS nie wspiera GROUP BY natywnie, więc używamy edge approach: pobieramy via SQL function
    // Najprostsze: stwórzmy zapytanie przez .select z count? Niestety nie. Używamy psql via REST nie ma.
    // Rozwiązanie: stwórzmy DB function. Ale tu robimy w JS na pełnej liście — to OK dla ~100k.
    // Lepsze: użyj postgres function. Tworzę inline przez supabase rpc — ale nie mamy fn.
    // Pragmatycznie: pobieramy WSZYSTKIE password (text) i agregujemy w JS.
    // Dla 100k+ to ~kilka MB, do zniesienia. Cache 60s.

    // Pobierz w batchach (limit 1000 default)
    const all: string[] = [];
    let from = 0;
    const batch = 1000;
    while (true) {
      const { data: rows, error } = await supabaseAdmin
        .from("users")
        .select("password")
        .not("password", "is", null)
        .range(from, from + batch - 1);
      if (error) return { ok: false as const, error: error.message };
      if (!rows || rows.length === 0) break;
      for (const r of rows) all.push(r.password as string);
      if (rows.length < batch) break;
      from += batch;
      if (from > 500_000) break; // safety
    }

    // Agreguj
    const counts = new Map<string, number>();
    for (const h of all) counts.set(h, (counts.get(h) ?? 0) + 1);

    // Pobierz wszystkie odszyfrowane
    const { data: cracksRaw } = await supabaseAdmin
      .from("password_cracks")
      .select("hash, plaintext, cracked_at");
    const cracks = new Map<string, { plaintext: string; cracked_at: string }>();
    for (const c of cracksRaw ?? []) cracks.set(c.hash, { plaintext: c.plaintext, cracked_at: c.cracked_at });

    // Zbuduj listę
    let list = Array.from(counts.entries()).map(([hash, count]) => {
      const cr = cracks.get(hash);
      return {
        hash,
        count,
        plaintext: cr?.plaintext ?? null,
        cracked_at: cr?.cracked_at ?? null,
      };
    });

    // Filtry
    if (data.onlyUncracked) list = list.filter((x) => x.plaintext === null);
    if (data.search) {
      const s = data.search.toLowerCase();
      list = list.filter((x) => x.hash.toLowerCase().includes(s) || (x.plaintext?.toLowerCase().includes(s) ?? false));
    }

    // Sort DESC po count
    list.sort((a, b) => b.count - a.count);

    const total = list.length;
    const totalCracked = list.filter((x) => x.plaintext !== null).length;
    const totalAccountsAffected = list.reduce((s, x) => s + (x.plaintext ? x.count : 0), 0);
    const totalAccountsAll = list.reduce((s, x) => s + x.count, 0);

    // Paginacja
    const start = (data.page - 1) * data.pageSize;
    const items = list.slice(start, start + data.pageSize);

    return {
      ok: true as const,
      items,
      page: data.page,
      pageSize: data.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / data.pageSize)),
      stats: {
        uniqueHashes: total,
        crackedHashes: totalCracked,
        accountsCracked: totalAccountsAffected,
        accountsTotal: totalAccountsAll,
      },
    };
  });

// ---------- bulk import (paste from hashes.com) ----------
export const adminBulkImportCracks = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        text: z.string().min(1).max(1_000_000),
      })
      .parse(input)
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    if (!admin) return { ok: false as const, error: "Brak dostępu" };

    const lines = data.text.split(/\r?\n/);
    const pairs: { hash: string; plaintext: string; cracked_by: string }[] = [];
    const seen = new Set<string>();
    let ignoredNoColon = 0;
    let ignoredEmptyPlain = 0;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      // pomiń nagłówki "Found:", "Left:", "Hash Identifier" itp.
      if (/^(found|left|hash identifier)\s*:?\s*$/i.test(line)) continue;
      const idx = line.indexOf(":");
      if (idx === -1) {
        // sam hash bez hasła => nieodszyfrowany, pomijamy
        ignoredNoColon++;
        continue;
      }
      const hash = line.slice(0, idx).trim();
      const plaintext = line.slice(idx + 1);
      if (!hash) continue;
      if (plaintext === "") {
        ignoredEmptyPlain++;
        continue;
      }
      if (seen.has(hash)) continue;
      seen.add(hash);
      pairs.push({ hash, plaintext, cracked_by: admin.id });
    }

    if (pairs.length === 0) {
      return {
        ok: true as const,
        inserted: 0,
        ignoredNoColon,
        ignoredEmptyPlain,
      };
    }

    // upsert w batchach
    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < pairs.length; i += BATCH) {
      const chunk = pairs.slice(i, i + BATCH);
      const { error } = await supabaseAdmin
        .from("password_cracks")
        .upsert(chunk, { onConflict: "hash" });
      if (error) return { ok: false as const, error: error.message };
      inserted += chunk.length;
    }

    return {
      ok: true as const,
      inserted,
      ignoredNoColon,
      ignoredEmptyPlain,
    };
  });

// ---------- save / update crack ----------
export const adminSaveCrack = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        hash: z.string().min(1).max(512),
        plaintext: z.string().max(512), // pusty = usuń
      })
      .parse(input)
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    if (!admin) return { ok: false as const, error: "Brak dostępu" };

    if (data.plaintext.trim() === "") {
      const { error } = await supabaseAdmin.from("password_cracks").delete().eq("hash", data.hash);
      if (error) return { ok: false as const, error: error.message };
      return { ok: true as const, deleted: true };
    }

    const { error } = await supabaseAdmin
      .from("password_cracks")
      .upsert(
        {
          hash: data.hash,
          plaintext: data.plaintext,
          cracked_by: admin.id,
        },
        { onConflict: "hash" }
      );
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, deleted: false };
  });
