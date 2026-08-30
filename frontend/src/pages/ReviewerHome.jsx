import PortalLanding from "./PortalLanding.jsx";

export default function ReviewerHome() {
  return (
    <PortalLanding
      portal="Reviewer"
      description="Work the exception queue with the AI Review Assistant."
      features={[
        { tag: "Prompt 10", title: "Exception Queue", desc: "Filterable, keyboard-nav queue of open validation exceptions." },
        { tag: "Prompt 14", title: "Reconciliation", desc: "Side-by-side loan_tape vs servicer_update diff." },
        { tag: "Prompt 13", title: "AI Review Panel", desc: "Reasoning chain + Accept / Edit / Reject controls." },
      ]}
    />
  );
}
