import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { login as loginFn, logout as logoutFn, register as registerFn } from "@/server/auth.functions";
import { hasRequiredRank, type AccountRank } from "@/lib/ranks";

export type AuthUser = {
  id: string;
  nick: string;
  email: string;
  role: "user" | "admin";
  rank: AccountRank;
};

type AuthContextValue = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  canAccessHashes: boolean;
  canAccessAdminPanel: boolean;
  isCeo: boolean;
  login: (nick: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  register: (nick: string, email: string, password: string, website: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  setUser: (u: AuthUser | null) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ initialUser, children }: { initialUser: AuthUser | null; children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(initialUser);

  const login = useCallback(async (nick: string, password: string) => {
    const r = await loginFn({ data: { nick, password } });
    if (r.ok) {
      setUser(r.user as AuthUser);
      return { ok: true };
    }
    return { ok: false, error: r.error };
  }, []);

  const register = useCallback(async (nick: string, email: string, password: string, website: string) => {
    const r = await registerFn({ data: { nick, email, password, website } });
    if (r.ok) {
      setUser(r.user as AuthUser);
      return { ok: true };
    }
    return { ok: false, error: r.error };
  }, []);

  const logout = useCallback(async () => {
    await logoutFn();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        canAccessHashes: hasRequiredRank(user?.rank, "moderator"),
        canAccessAdminPanel: hasRequiredRank(user?.rank, "administrator"),
        isCeo: user?.rank === "ceo",
        login,
        register,
        logout,
        setUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
