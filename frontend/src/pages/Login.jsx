import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth, roleHomePath } from "../context/AuthContext.jsx";
import Button from "../components/ui/Button.jsx";
import Spinner from "../components/ui/Spinner.jsx";

const SEED_USERS = [
  { role: "Operator", email: "operator@intain.test", password: "Operator@123" },
  { role: "Reviewer", email: "reviewer@intain.test", password: "Reviewer@123" },
  { role: "Consumer", email: "consumer@intain.test", password: "Consumer@123" },
  { role: "Admin", email: "admin@intain.test", password: "Admin@1234" },
];

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Prefill from ?email=&password= (used by Home's seeded-user quick-login links).
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const e = p.get("email");
    const pw = p.get("password");
    if (e) setEmail(e);
    if (pw) setPassword(pw);
  }, [location.search]);

  if (user) {
    const dest = location.state?.from || roleHomePath(user.role);
    navigate(dest, { replace: true });
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const u = await login(email.trim(), password);
      const dest = location.state?.from || roleHomePath(u.role);
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  const useSeed = (seed) => {
    setEmail(seed.email);
    setPassword(seed.password);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Intain Verify</h1>
          <p className="mt-1 text-sm text-slate-500">Loan Data Verification Copilot</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        >
          <label className="block text-sm font-medium text-slate-700">Email</label>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            placeholder="you@example.com"
          />

          <label className="mt-4 block text-sm font-medium text-slate-700">Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            placeholder="********"
          />

          {error && (
            <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <Button type="submit" className="mt-5 w-full" disabled={submitting}>
            {submitting ? <Spinner size="sm" label="Signing in" /> : "Sign in"}
          </Button>

          <Link to="/" className="mt-4 block text-center text-xs text-slate-500 hover:text-slate-700">
            Back to home
          </Link>
        </form>

        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4 text-xs">
          <p className="font-semibold text-slate-600">Seeded test users (click to fill)</p>
          <ul className="mt-2 divide-y divide-slate-100">
            {SEED_USERS.map((s) => (
              <li key={s.email}>
                <button
                  type="button"
                  onClick={() => useSeed(s)}
                  className="flex w-full items-center justify-between py-1.5 text-left text-slate-600 hover:text-slate-900"
                >
                  <span>
                    <span className="font-medium text-slate-800">{s.role}</span>
                    <span className="text-slate-500"> · {s.email}</span>
                  </span>
                  <span className="font-mono text-slate-400">{s.password}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
