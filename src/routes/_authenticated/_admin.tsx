import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { hasRequiredRank, type AccountRank } from "@/lib/ranks";

export const Route = createFileRoute("/_authenticated/_admin")({
  beforeLoad: ({ context }) => {
    const ctx = context as { user?: { rank: AccountRank } | null };
    if (!ctx.user || !hasRequiredRank(ctx.user.rank, "administrator")) {
      throw redirect({ to: "/" });
    }
  },
  component: () => <Outlet />,
});
