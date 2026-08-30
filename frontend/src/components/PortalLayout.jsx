import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import Badge from "./ui/Badge.jsx";
import Button from "./ui/Button.jsx";

const ACCENTS = {
  operator: {
    label: "Operator",
    badge: "blue",
    sidebar: "bg-blue-50 border-blue-100",
    activeLink: "bg-blue-600 text-white",
    hoverLink: "hover:bg-blue-100 text-blue-900",
    ring: "ring-blue-500",
  },
  reviewer: {
    label: "Reviewer",
    badge: "amber",
    sidebar: "bg-amber-50 border-amber-100",
    activeLink: "bg-amber-500 text-white",
    hoverLink: "hover:bg-amber-100 text-amber-900",
    ring: "ring-amber-500",
  },
  consumer: {
    label: "Data Consumer",
    badge: "emerald",
    sidebar: "bg-emerald-50 border-emerald-100",
    activeLink: "bg-emerald-600 text-white",
    hoverLink: "hover:bg-emerald-100 text-emerald-900",
    ring: "ring-emerald-500",
  },
  "dev-log": {
    label: "Dev Log",
    badge: "slate",
    sidebar: "bg-slate-100 border-slate-200",
    activeLink: "bg-slate-800 text-white",
    hoverLink: "hover:bg-slate-200 text-slate-900",
    ring: "ring-slate-500",
  },
};

export default function PortalLayout({ portal, links = [] }) {
  const accent = ACCENTS[portal] || ACCENTS["dev-log"];
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="text-base font-semibold text-slate-900">Intain Verify</span>
            <Badge tone={accent.badge}>{accent.label}</Badge>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {user && (
              <span className="text-slate-600">
                {user.name || user.email}
                <span className="text-slate-400"> · {user.email}</span>
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={onLogout}>
              Logout
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-6 py-6">
        <aside className={`w-56 shrink-0 rounded-lg border p-3 ${accent.sidebar}`}>
          <nav className="flex flex-col gap-1">
            {links
              .filter((link) => !link.roles || link.roles.includes(user?.role))
              .map((link) => (
                <SidebarLink key={link.to || link.label} link={link} accent={accent} />
              ))}
          </nav>
        </aside>

        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SidebarLink({ link, accent }) {
  const base = "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition";
  if (link.disabled || !link.to || link.to === "#") {
    return (
      <span className={`${base} cursor-not-allowed text-slate-400`}>
        {link.label}
        {link.badge && (
          <span className="ml-2 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
            {link.badge}
          </span>
        )}
      </span>
    );
  }
  return (
    <NavLink
      to={link.to}
      end={link.end}
      className={({ isActive }) =>
        `${base} ${isActive ? accent.activeLink : accent.hoverLink}`
      }
    >
      <span>{link.label}</span>
      {link.badge && (
        <span className="ml-2 rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
          {link.badge}
        </span>
      )}
    </NavLink>
  );
}
