import PortalLanding from "./PortalLanding.jsx";

export default function OperatorHome() {
  return (
    <PortalLanding
      portal="Operator"
      description="Upload loan tapes, servicer updates, and document manifests."
      features={[
        { tag: "Prompt 8", title: "Uploads", desc: "Drag-drop CSVs with preview + hash lineage." },
        { tag: "Prompt 8", title: "Import History", desc: "Every batch, every failed row, inspectable." },
        { tag: "Prompt 20", title: "Dashboard", desc: "Operations health KPIs and staleness view." },
      ]}
    />
  );
}
