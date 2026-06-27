import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { api } from "./api";
import type { User } from "./types";

interface AuthMethods {
  devLogin: boolean;
  startgg: boolean;
}

interface AuthValue {
  user: User | null;
  loading: boolean;
  online: boolean;
  methods: AuthMethods;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<User>;
  register: (username: string, password: string) => Promise<User>;
  devLogin: () => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Which auth methods the backend offers (dev login, start.gg).
  const [methods, setMethods] = useState<AuthMethods>({
    devLogin: false,
    startgg: false,
  });
  // Whether the backend is reachable at all (offline / static build => false).
  const [online, setOnline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [h, me] = await Promise.all([api.health(), api.me()]);
      setMethods({ devLogin: !!h.devLogin, startgg: !!h.startgg });
      setOnline(true);
      setUser(me.user ?? null);
    } catch {
      setOnline(false);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (username: string, password: string) => {
    const { user } = await api.login(username, password);
    setUser(user);
    return user;
  };
  const register = async (username: string, password: string) => {
    const { user } = await api.register(username, password);
    setUser(user);
    return user;
  };
  const devLogin = async () => {
    const { user } = await api.devLogin();
    setUser(user);
    return user;
  };
  const logout = async () => {
    await api.logout();
    setUser(null);
  };

  const value: AuthValue = {
    user,
    loading,
    online,
    methods,
    refresh,
    login,
    register,
    devLogin,
    logout,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
