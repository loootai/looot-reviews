import { Empty } from "@/components/Empty";
import { ThemesView } from "@/components/ThemesView";
import { loadReport } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Themes" };

export default async function ThemesPage() {
  const report = await loadReport();
  if (!report) return <Empty />;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-20 font-semibold">Themes</h1>
        <p className="mt-1 text-13 text-mute">Named themes come from <code className="num">config/themes.json</code>. Found themes come from phrases that many reviews share. Counts are reviews that mention the theme.</p>
      </div>
      <ThemesView report={report} />
    </div>
  );
}
