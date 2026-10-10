import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { AppShell, type ShellNavSection } from "@/components/AppShell";
import { IS_DEMO } from "@/lib/clock";
import { usd } from "@/lib/money";
import { loadReport } from "@/lib/store";
import "./globals.css";

export const dynamic = "force-dynamic";

const NAV: ShellNavSection[] = [
  {
    items: [
      { href: "/", label: "Overview", icon: "dashboard" },
      { href: "/themes", label: "Themes", icon: "layers" },
      { href: "/new", label: "New pull", icon: "play" },
    ],
  },
];

export const metadata: Metadata = {
  title: { default: "looot-reviews", template: "%s · looot-reviews" },
  description: "Open-source review intelligence. Google Maps, App Store, Google Play and Tripadvisor reviews through looot, grouped into themes, with competitor weak spots.",
  icons: { icon: "/brand/looot-mark.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F8F5" },
    { media: "(prefers-color-scheme: dark)", color: "#0A1512" },
  ],
};

// Sets the theme class before the first paint. ?theme=dark or ?theme=light overrides the saved choice for one view.
const themeScript = `(function(){try{var q=new URLSearchParams(location.search).get("theme");var t=q||localStorage.getItem("theme")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const report = await loadReport();
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-page text-ink">
        <AppShell
          appName="looot-reviews"
          githubHref="https://github.com/loootai/looot-reviews"
          nav={NAV}
          demoLabel={IS_DEMO ? "Demo data, invented shops and reviews" : undefined}
          spend={report ? { label: "Spent this pull", spent: usd(report.spendMicros), cap: usd(report.capMicros), ratio: report.capMicros > 0 ? report.spendMicros / report.capMicros : 0 } : undefined}
          primaryAction={{ href: "/new", label: "New pull" }}
        >
          <div className="mx-auto max-w-[1200px] px-4 py-6">{children}</div>
        </AppShell>
      </body>
    </html>
  );
}
