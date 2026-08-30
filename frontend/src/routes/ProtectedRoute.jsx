import { Navigate, Outlet, useLocation } from "react-router-dom";
import { roleHomePath, useAuth } from "../context/AuthContext.jsx";
import Spinner from "../components/ui/Spinner.jsx";

export default function ProtectedRoute({ allowedRoles }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner label="Checking session" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    return <Navigate to={roleHomePath(user.role)} replace />;
  }

  return <Outlet />;
}
