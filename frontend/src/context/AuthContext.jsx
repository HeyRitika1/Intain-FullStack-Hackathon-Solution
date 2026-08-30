import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, getStoredToken, setStoredToken } from "../lib/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => getStoredToken());
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getStoredToken()));

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    apiGet("/auth/me")
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch(() => {
        if (!cancelled) {
          setStoredToken(null);
          setToken(null);
          setUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = useCallback(async (email, password) => {
    const res = await apiPost("/auth/login", { email, password });
    setStoredToken(res.token);
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    setStoredToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, token, loading, login, logout }),
    [user, token, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export function roleHomePath(role) {
  switch (role) {
    case "operator":
      return "/operator";
    case "reviewer":
      return "/reviewer";
    case "consumer":
      return "/consumer";
    case "admin":
      return "/reviewer";
    default:
      return "/login";
  }
}
