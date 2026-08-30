import Card from "../../components/ui/Card.jsx";
import ConversePanel from "../../components/converse/ConversePanel.jsx";

export default function ConversePage() {
  return (
    <div className="space-y-4">
      <Card>
        <ConversePanel />
      </Card>
    </div>
  );
}
