import { NewPull } from "@/components/NewPull";
import { IS_DEMO } from "@/lib/clock";
import { hasLoootToken } from "@/lib/looot";

export const dynamic = "force-dynamic";
export const metadata = { title: "New pull" };

export default function NewPage() {
  return <NewPull demo={IS_DEMO} hasToken={hasLoootToken()} />;
}
