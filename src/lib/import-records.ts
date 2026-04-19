export type ImportRecord = {
  name: string;
  authorization?: {
    password?: string | null;
    firstIP?: string | null;
    lastIP?: string | null;
    premium?: boolean | null;
  } | null;
  connectedAccounts?: {
    discordEmail?: string | null;
  } | null;
};

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

function hasUserMetadata(obj: Record<string, unknown>) {
  const authorization =
    asObject(obj.authorization) ?? asObject(obj.auth) ?? asObject(obj.authorizationData);
  const connectedAccounts =
    asObject(obj.connectedAccounts) ?? asObject(obj.accounts) ?? asObject(obj.connected_accounts);

  return Boolean(
    authorization ||
      connectedAccounts ||
      asTrimmedString(obj.password) ||
      asTrimmedString(obj.firstIP) ||
      asTrimmedString(obj.first_ip) ||
      asTrimmedString(obj.lastIP) ||
      asTrimmedString(obj.last_ip) ||
      asTrimmedString(obj.discordEmail) ||
      asTrimmedString(obj.discord_email) ||
      asBoolean(obj.premium) !== null,
  );
}

export function normalizeImportRecord(
  value: unknown,
  options?: { nameHint?: string | null },
): ImportRecord | null {
  const obj = asObject(value);
  if (!obj) return null;

  const authorization =
    asObject(obj.authorization) ?? asObject(obj.auth) ?? asObject(obj.authorizationData);
  const connectedAccounts =
    asObject(obj.connectedAccounts) ?? asObject(obj.accounts) ?? asObject(obj.connected_accounts);

  const directName =
    asTrimmedString(obj.name) ??
    asTrimmedString(obj.nick) ??
    asTrimmedString(obj.nickname) ??
    asTrimmedString(obj.username);

  const hintedName = !directName && hasUserMetadata(obj) ? asTrimmedString(options?.nameHint) : null;
  const name = directName ?? hintedName;

  if (!name || name.length > 64) return null;

  const normalizedAuthorization = {
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
  };

  const normalizedConnectedAccounts = {
    discordEmail:
      asTrimmedString(connectedAccounts?.discordEmail) ??
      asTrimmedString(connectedAccounts?.discord_email) ??
      asTrimmedString(obj.discordEmail) ??
      asTrimmedString(obj.discord_email) ??
      undefined,
  };

  return {
    name,
    authorization: Object.values(normalizedAuthorization).some((value) => value != null)
      ? normalizedAuthorization
      : undefined,
    connectedAccounts: Object.values(normalizedConnectedAccounts).some((value) => value != null)
      ? normalizedConnectedAccounts
      : undefined,
  };
}

export function extractImportRecords(raw: unknown): ImportRecord[] {
  const records: ImportRecord[] = [];
  const seen = new WeakSet<object>();

  const visit = (value: unknown, depth: number, nameHint?: string | null) => {
    if (depth > 12 || value == null || typeof value !== "object") return;

    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }

    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) return;
    seen.add(obj);

    const normalized = normalizeImportRecord(obj, { nameHint });
    if (normalized) {
      records.push(normalized);
      return;
    }

    for (const [childKey, childValue] of Object.entries(obj)) {
      visit(childValue, depth + 1, childKey);
    }
  };

  visit(raw, 0);
  return records;
}