import Workspace from "@/components/Workspace";
import { mockMode } from "@/lib/providers";
import summary from "@/data/market_summary.json";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return <><a className="skip-link" href="#atlas-main">Skip to explorer</a><Workspace summary={summary} offline={mockMode()} /></>;
}
