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
      if (from > 500_000) break;
    }

    const counts = new Map<string, number>();
    for (const h of all) counts.set(h, (counts.get(h) ?? 0) + 1);

    const [{ data: cracksRaw }, { data: failuresRaw }] = await Promise.all([
      supabaseAdmin.from("password_cracks").select("hash, plaintext, cracked_at"),
      supabaseAdmin.from("hash_failures").select("hash, marked_at"),
    ]);
    const cracks = new Map<string, { plaintext: string; cracked_at: string }>();
    for (const c of cracksRaw ?? []) cracks.set(c.hash, { plaintext: c.plaintext, cracked_at: c.cracked_at });
    const failures = new Map<string, string>();
    for (const f of failuresRaw ?? []) failures.set(f.hash, f.marked_at);

    let list = Array.from(counts.entries()).map(([hash, count]) => {
      const cr = cracks.get(hash);
      return {
        hash,
        count,
        plaintext: cr?.plaintext ?? null,
        cracked_at: cr?.cracked_at ?? null,
        failed: failures.has(hash),
        failed_at: failures.get(hash) ?? null,
      };
    });

    if (data.onlyUncracked) list = list.filter((x) => x.plaintext === null);
    if (data.search) {
      const s = data.search.toLowerCase();
      list = list.filter((x) => x.hash.toLowerCase().includes(s) || (x.plaintext?.toLowerCase().includes(s) ?? false));
    }

    list.sort((a, b) => b.count - a.count);

    const total = list.length;
    const totalCracked = list.filter((x) => x.plaintext !== null).length;
    const totalFailed = list.filter((x) => x.failed).length;
    const totalAccountsAffected = list.reduce((s, x) => s + (x.plaintext ? x.count : 0), 0);
    const totalAccountsAll = list.reduce((s, x) => s + x.count, 0);

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
        failedHashes: totalFailed,
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
        text: z.string().min(1).max(2_000_000),
      })
      .parse(input)
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    if (!admin) return { ok: false as const, error: "Brak dostępu" };

    const lines = data.text.split(/\r?\n/);
    const pairs: { hash: string; plaintext: string; cracked_by: string }[] = [];
    const failedHashes: { hash: string; marked_by: string }[] = [];
    const seenPair = new Set<string>();
    const seenFail = new Set<string>();
    let ignoredEmptyPlain = 0;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (/^(found|left|hash identifier)\s*:?\s*$/i.test(line)) continue;
      const idx = line.indexOf(":");
      if (idx === -1) {
        // sam hash bez hasła => oznacz jako "nie do złamania"
        const hash = line;
        if (!seenFail.has(hash)) {
          seenFail.add(hash);
          failedHashes.push({ hash, marked_by: admin.id });
        }
        continue;
      }
      const hash = line.slice(0, idx).trim();
      const plaintext = line.slice(idx + 1);
      if (!hash) continue;
      if (plaintext === "") {
        ignoredEmptyPlain++;
        continue;
      }
      if (seenPair.has(hash)) continue;
      seenPair.add(hash);
      pairs.push({ hash, plaintext, cracked_by: admin.id });
    }

    const BATCH = 500;
    let inserted = 0;
    let markedFailed = 0;

    for (let i = 0; i < pairs.length; i += BATCH) {
      const chunk = pairs.slice(i, i + BATCH);
      const { error } = await supabaseAdmin
        .from("password_cracks")
        .upsert(chunk, { onConflict: "hash" });
      if (error) return { ok: false as const, error: error.message };
      inserted += chunk.length;
      // jeśli udało się złamać, usuń go z hash_failures (gdyby był wcześniej oznaczony)
      const hashesToUnmark = chunk.map((c) => c.hash);
      await supabaseAdmin.from("hash_failures").delete().in("hash", hashesToUnmark);
    }

    for (let i = 0; i < failedHashes.length; i += BATCH) {
      const chunk = failedHashes.slice(i, i + BATCH);
      const { error } = await supabaseAdmin
        .from("hash_failures")
        .upsert(chunk, { onConflict: "hash" });
      if (error) return { ok: false as const, error: error.message };
      markedFailed += chunk.length;
    }

    return {
      ok: true as const,
      inserted,
      markedFailed,
      ignoredEmptyPlain,
    };
  });

// ---------- save / update crack ----------
export const adminSaveCrack = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        hash: z.string().min(1).max(512),
        plaintext: z.string().max(512),
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
    // jeśli był oznaczony jako failed, odznacz
    await supabaseAdmin.from("hash_failures").delete().eq("hash", data.hash);
    return { ok: true as const, deleted: false };
  });

// ---------- toggle "failed" mark ----------
export const adminToggleHashFailed = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        hash: z.string().min(1).max(512),
        failed: z.boolean(),
      })
      .parse(input)
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    if (!admin) return { ok: false as const, error: "Brak dostępu" };

    if (data.failed) {
      const { error } = await supabaseAdmin
        .from("hash_failures")
        .upsert({ hash: data.hash, marked_by: admin.id }, { onConflict: "hash" });
      if (error) return { ok: false as const, error: error.message };
    } else {
      const { error } = await supabaseAdmin.from("hash_failures").delete().eq("hash", data.hash);
      if (error) return { ok: false as const, error: error.message };
    }
    return { ok: true as const };
  });
