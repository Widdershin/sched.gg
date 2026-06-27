import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { api } from "./api.js";

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Which auth methods the backend offers (dev login, start.gg).
  const [methods, setMethods] = useState({ devLogin: false, startgg: false });
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

  const login = async (username, password) => {
    const { user } = await api.login(username, password);
    setUser(user);
    return user;
  };
  const register = async (username, password) => {
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

  const value = {
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
