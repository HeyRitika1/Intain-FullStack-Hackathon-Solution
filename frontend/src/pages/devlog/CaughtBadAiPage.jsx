import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../../lib/api.js";
import { toast } from "../../components/ui/Toast.jsx";
import Card from "../../components/ui/Card.jsx";
import Spinner from "../../components/ui/Spinner.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import DevLogCard from "../../components/DevLogCard.jsx";

export default function CaughtBadAiPage() {
  const [items, setItems] = useState(null);

  useEffect(() => {
    apiGet("/dev-log?outcome=caught_bad_ai&limit=50")
      .then((r) => setItems(r.items))
      .catch((e) => toast.error(e.message));
  }, []);

  return (
    <div className="space-y-4">
      <Card className="border-l-4 border-l-red-500">
        <div className="flex items-center gap-3">
          <div className="text-3xl">⚠</div>
          <div>
            <h1 className="text-lg font-semibold text-red-800">Where we caught the AI being wrong.</h1>
            <p className="text-xs text-slate-600">
              Every AI-drafted suggestion goes through a human review gate. These are the moments where that gate mattered.
            </p>
          </div>
        </div>
      </Card>

      {items === null && <Spinner label="Loading" />}
      {items && items.length === 0 && (
        <EmptyState title="No entries" description="Seed the dev log first." action={<Link to="/dev-log" className="text-slate-700 underline">All entries →</Link>} />
      )}
      {items && items.map((e) => <DevLogCard key={e._id} entry={e} emphasize />)}
    </div>
  );
}
