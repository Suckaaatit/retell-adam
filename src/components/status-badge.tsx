import { Badge } from "@/components/ui/badge";
import { getStatusTone } from "@/lib/utils";

type StatusBadgeProps = {
  status: string | null | undefined;
};

function formatStatusLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const value = status || "unknown";
  const tone = getStatusTone(value);
  const variant =
    tone === "success" ? "success" : tone === "warning" ? "warning" : tone === "danger" ? "danger" : "neutral";
  return (
    <Badge variant={variant}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />
      {formatStatusLabel(value)}
    </Badge>
  );
}
