export type AccountRank = "new" | "moderator" | "administrator" | "ceo";

export const RANK_ORDER: AccountRank[] = ["new", "moderator", "administrator", "ceo"];

export const RANK_LABELS: Record<AccountRank, string> = {
  new: "Nowy",
  moderator: "Moderator",
  administrator: "Administrator",
  ceo: "CEO",
};

export function hasRequiredRank(rank: AccountRank | null | undefined, minimum: AccountRank) {
  if (!rank) return false;
  return RANK_ORDER.indexOf(rank) >= RANK_ORDER.indexOf(minimum);
}