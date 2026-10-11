import { NewPull } from "@/components/NewPull";
import { requireAdminPage } from "@/lib/auth/guard";
import { IS_DEMO } from "@/lib/clock";
import { hasLoootToken } from "@/lib/looot";
import { serverCapMicros } from "@/lib/serverCap";

export const dynamic = "force-dynamic";
export const metadata = { title: "New pull" };

export default async function NewPage() {
  await requireAdminPage();
  return <NewPull demo={IS_DEMO} hasToken={hasLoootToken()} capMicros={serverCapMicros()} />;
}
