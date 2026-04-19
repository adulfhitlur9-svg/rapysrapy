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

type ImportRecord = z.infer<typeof recordSchema>;

const DB_CHUNK_SIZE = 500;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "premium"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "free"].includes(normalized)) return false;
  }
  return null;
}

function normalizeImportRecord(value: unknown): ImportRecord | null {
  const obj = asObject(value);
  if (!obj) return null;

  const authorization =
    asObject(obj.authorization) ?? asObject(obj.auth) ?? asObject(obj.authorizationData);
  const connectedAccounts =
    asObject(obj.connectedAccounts) ?? asObject(obj.accounts) ?? asObject(obj.connected_accounts);

  const candidate = {
    name:
      asTrimmedString(obj.name) ??
      asTrimmedString(obj.nick) ??
      asTrimmedString(obj.nickname) ??
      asTrimmedString(obj.username),
    authorization: {
      password:
        asTrimmedString(authorization?.password) ?? asTrimmedString(obj.password) ?? undefined,
      firstIP:
        asTrimmedString(authorization?.firstIP) ??
        asTrimmedString(authorization?.first_ip) ??
        asTrimmedString(obj.firstIP) ??
        asTrimmedString(obj.first_ip) ??
        undefined,
      lastIP:
        asTrimmedString(authorization?.lastIP) ??
        asTrimmedString(authorization?.last_ip) ??
        asTrimmedString(obj.lastIP) ??
        asTrimmedString(obj.last_ip) ??
        undefined,
      premium: asBoolean(authorization?.premium) ?? asBoolean(obj.premium) ?? undefined,
    },
    connectedAccounts: {
      discordEmail:
        asTrimmedString(connectedAccounts?.discordEmail) ??
        asTrimmedString(connectedAccounts?.discord_email) ??
        asTrimmedString(obj.discordEmail) ??
        asTrimmedString(obj.discord_email) ??
        undefined,
    },
  };

  const parsed = recordSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function extractImportRecords(raw: unknown): ImportRecord[] {
  const records: ImportRecord[] = [];
  const seen = new WeakSet<object>();

  const visit = (value: unknown, depth: number) => {
    if (depth > 12 || value == null || typeof value !== "object") return;

    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }

    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) return;
    seen.add(obj);

    const normalized = normalizeImportRecord(obj);
    if (normalized) {
      records.push(normalized);
      return;
    }

    for (const child of Object.values(obj)) visit(child, depth + 1);
  };

  visit(raw, 0);
  return records;
}

const importSchema = z.object({
  token: z.string().min(1),
  records: z.array(z.unknown()).min(1).max(5000),
});

export const verifyAdminToken = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const expected = process.env.ADMIN_IMPORT_TOKEN;
    if (!expected) return { ok: false as const, error: "Brak ADMIN_IMPORT_TOKEN w konfiguracji serwera" };
    return { ok: data.token === expected, error: null };
  });

export const bulkImport = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => importSchema.parse(input))
  .handler(async ({ data }) => {
    const expected = process.env.ADMIN_IMPORT_TOKEN;
    if (!expected || data.token !== expected) {
      return { inserted: 0, skipped: 0, error: "Unauthorized" };
    }
    const rows: Array<{
      name: string;
      name_lower: string;
      password: string | null;
      first_ip: string | null;
      last_ip: string | null;
      premium: boolean;
      discord_email: string | null;
    }> = [];

    let skipped = 0;
    const seenNames = new Set<string>();
    for (const raw of data.records) {
      const extracted = extractImportRecords(raw);
      if (extracted.length === 0) {
        skipped++;
        continue;
      }

      for (const r of extracted) {
        const normalizedName = r.name.trim().toLowerCase();
        if (!normalizedName) {
          skipped++;
          continue;
        }
        if (seenNames.has(normalizedName)) {
          skipped++;
          continue;
        }

        seenNames.add(normalizedName);
        rows.push({
          name: r.name.trim(),
          name_lower: normalizedName,
          password: r.authorization?.password ?? null,
          first_ip: r.authorization?.firstIP ?? null,
          last_ip: r.authorization?.lastIP ?? null,
          premium: !!r.authorization?.premium,
          discord_email: r.connectedAccounts?.discordEmail ?? null,
        });
      }
    }

    if (rows.length === 0) {
      return { inserted: 0, skipped, error: null };
    }

    let inserted = 0;

    for (let i = 0; i < rows.length; i += DB_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + DB_CHUNK_SIZE);
      const names = chunk.map((row) => row.name_lower);

      const { data: existingRows, error: existingError } = await supabaseAdmin
        .from("users")
        .select("name_lower")
        .in("name_lower", names);

      if (existingError) {
        console.error("bulkImport existing lookup error", existingError);
        return { inserted, skipped, error: existingError.message };
      }

      const existing = new Set(
        (existingRows ?? [])
          .map((row) => row.name_lower)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      );

      const freshRows = chunk.filter((row) => !existing.has(row.name_lower));
      skipped += chunk.length - freshRows.length;

      if (freshRows.length === 0) continue;

      const { error, count } = await supabaseAdmin.from("users").insert(freshRows, {
        count: "exact",
      });

      if (error) {
        console.error("bulkImport insert error", error);
        return { inserted, skipped, error: error.message };
      }

      const insertedNow = count ?? freshRows.length;
      inserted += insertedNow;
      skipped += Math.max(0, freshRows.length - insertedNow);
    }

    return { inserted, skipped, error: null };
  });

// ---------- Stats ----------
export const getStats = createServerFn({ method: "GET" }).handler(async () => {
  const { count } = await supabaseAdmin
    .from("users")
    .select("*", { count: "exact", head: true });
  return { total: count ?? 0 };
});
