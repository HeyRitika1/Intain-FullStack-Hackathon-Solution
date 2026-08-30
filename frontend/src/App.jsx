import { Link, Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import Home from "./pages/Home.jsx";
import Login from "./pages/Login.jsx";
import ConsumerHome from "./pages/ConsumerHome.jsx";
import UploadPage from "./pages/operator/UploadPage.jsx";
import ImportHistoryPage from "./pages/operator/ImportHistoryPage.jsx";
import OperatorDashboard from "./pages/operator/OperatorDashboard.jsx";
import ExceptionQueuePage from "./pages/reviewer/ExceptionQueuePage.jsx";
import LoanDetailPage from "./pages/reviewer/LoanDetailPage.jsx";
import ReconciliationPage from "./pages/reviewer/ReconciliationPage.jsx";
import ReviewerDashboard from "./pages/reviewer/ReviewerDashboard.jsx";
import AuditViewerPage from "./pages/consumer/AuditViewerPage.jsx";
import VerifiedRecordsPage from "./pages/consumer/VerifiedRecordsPage.jsx";
import VerifiedRecordDetailPage from "./pages/consumer/VerifiedRecordDetailPage.jsx";
import TrustScorePage from "./pages/consumer/TrustScorePage.jsx";
import ExportPage from "./pages/consumer/ExportPage.jsx";
import ConsumerDashboard from "./pages/consumer/ConsumerDashboard.jsx";
import ConversePage from "./pages/consumer/ConversePage.jsx";
import DevLogPage from "./pages/devlog/DevLogPage.jsx";
import CaughtBadAiPage from "./pages/devlog/CaughtBadAiPage.jsx";
import ByModulePage from "./pages/devlog/ByModulePage.jsx";
import RulesPage from "./pages/admin/RulesPage.jsx";
import PortalLayout from "./components/PortalLayout.jsx";
import ProtectedRoute from "./routes/ProtectedRoute.jsx";
import { Toaster } from "./components/ui/Toast.jsx";
import { apiGet } from "./lib/api.js";

const OPERATOR_LINKS = [
  { to: "/operator/dashboard", label: "Dashboard", end: true },
  { to: "/operator/uploads", label: "Uploads" },
  { to: "/operator/imports", label: "Import History" },
];
const REVIEWER_LINKS = [
  { to: "/reviewer/queue", label: "Exception Queue", end: true },
  { to: "/reviewer/reconciliation", label: "Reconciliation" },
  { to: "/reviewer/dashboard", label: "Dashboard" },
  { to: "/admin/rules", label: "Admin Rules", roles: ["admin"] },
];
const CONSUMER_LINKS = [
  { to: "/consumer/dashboard", label: "Dashboard", end: true },
  { to: "/consumer/verified", label: "Verified Records" },
  { to: "/consumer/trust", label: "Trust Score" },
  { to: "/consumer/audit", label: "Audit Viewer" },
  { to: "/consumer/converse", label: "Converse", badge: "beta" },
  { to: "/consumer/export", label: "Export" },
];
const DEV_LOG_LINKS = [
  { to: "/dev-log", label: "All Entries", end: true },
  { to: "/dev-log/by-module", label: "By Module" },
  { to: "/dev-log/caught-bad-ai", label: "Caught Bad AI" },
];

export default function App() {
  return (
    <>
      <Toaster />
      <ApiHealthBanner />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />

        <Route element={<ProtectedRoute allowedRoles={["operator", "admin"]} />}>
          <Route element={<PortalLayout portal="operator" links={OPERATOR_LINKS} />}>
            <Route path="/operator" element={<Navigate to="/operator/dashboard" replace />} />
            <Route path="/operator/uploads" element={<UploadPage />} />
            <Route path="/operator/imports" element={<ImportHistoryPage />} />
            <Route path="/operator/dashboard" element={<OperatorDashboard />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute allowedRoles={["reviewer", "admin"]} />}>
          <Route element={<PortalLayout portal="reviewer" links={REVIEWER_LINKS} />}>
            <Route path="/reviewer" element={<Navigate to="/reviewer/queue" replace />} />
            <Route path="/reviewer/queue" element={<ExceptionQueuePage />} />
            <Route path="/reviewer/loans/:loanId" element={<LoanDetailPage />} />
            <Route path="/reviewer/reconciliation" element={<ReconciliationPage />} />
            <Route path="/reviewer/dashboard" element={<ReviewerDashboard />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute allowedRoles={["admin"]} />}>
          <Route element={<PortalLayout portal="reviewer" links={REVIEWER_LINKS} />}>
            <Route path="/admin/rules" element={<RulesPage />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute allowedRoles={["consumer", "admin", "reviewer"]} />}>
          <Route element={<PortalLayout portal="consumer" links={CONSUMER_LINKS} />}>
            <Route path="/consumer" element={<ConsumerHome />} />
            <Route path="/consumer/dashboard" element={<ConsumerDashboard />} />
            <Route path="/consumer/verified" element={<VerifiedRecordsPage />} />
            <Route path="/consumer/verified/:loanId" element={<VerifiedRecordDetailPage />} />
            <Route path="/consumer/trust" element={<TrustScorePage />} />
            <Route path="/consumer/export" element={<ExportPage />} />
            <Route path="/consumer/audit" element={<AuditViewerPage />} />
            <Route path="/consumer/converse" element={<ConversePage />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute allowedRoles={["operator", "reviewer", "consumer", "admin"]} />}>
          <Route element={<PortalLayout portal="dev-log" links={DEV_LOG_LINKS} />}>
            <Route path="/dev-log" element={<DevLogPage />} />
            <Route path="/dev-log/by-module" element={<ByModulePage />} />
            <Route path="/dev-log/caught-bad-ai" element={<CaughtBadAiPage />} />
          </Route>
        </Route>

        <Route
          path="*"
          element={
            <div className="mx-auto max-w-lg px-6 py-16 text-center">
              <h1 className="text-2xl font-bold">404</h1>
              <p className="mt-2 text-slate-600">Page not found.</p>
              <Link to="/" className="mt-4 inline-block text-blue-600 hover:underline">
                Back to home
              </Link>
            </div>
          }
        />
      </Routes>
    </>
  );
}

// Sticky top banner shown only when /api/health can't be reached.
// Small but demo-friendly if the backend ever crashes mid-presentation.
function ApiHealthBanner() {
  const [down, setDown] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const check = () => apiGet("/health")
      .then(() => { if (!cancelled) setDown(false); })
      .catch(() => { if (!cancelled) setDown(true); });
    check();
    const id = setInterval(check, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  if (!down) return null;
  return (
    <div className="sticky top-0 z-50 bg-red-600 px-4 py-1.5 text-center text-xs font-semibold text-white shadow">
      API not reachable at :4000 — is <code className="rounded bg-red-800/50 px-1">npm run dev</code> running?
    </div>
  );
}
