import PortalLanding from "./PortalLanding.jsx";

export default function DevLog() {
  return (
    <PortalLanding
      portal="Dev Log"
      description="Agentic-coding evidence. Prompts, outcomes, and caught-bad-AI entries."
      features={[
        { tag: "Prompt 21", title: "All Entries", desc: "Reverse-chrono feed of every dev log entry." },
        { tag: "Prompt 21", title: "By Module", desc: "Coverage grid across ingestion, validation, AI, UI." },
        { tag: "Prompt 21", title: "Caught Bad AI", desc: "Where we caught the AI being wrong." },
      ]}
    />
  );
}
