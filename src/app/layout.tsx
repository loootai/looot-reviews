import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { AppShell, type ShellNavSection, type ShellSpend, type ShellSpendRow } from "@/components/AppShell";
import { currentCsrf, requireAdminPage } from "@/lib/auth/guard";
import { isPublicPath } from "@/lib/auth/routes";
import { IS_DEMO } from "@/lib/clock";
import { usd } from "@/lib/money";
import type { PeriodStatus } from "@/lib/budget";
import { budgetStatus } from "@/lib/budgetService";
import "./globals.css";

export const dynamic = "force-dynamic";

const NAV: ShellNavSection[] = [
  {
    items: [
      { href: "/", label: "Overview", icon: "dashboard" },
      { href: "/themes", label: "Themes", icon: "layers" },
      { href: "/new", label: "New pull", icon: "play" },
      { href: "/costs", label: "Costs", icon: "receipt" },
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
  const path = (await headers()).get("x-reviews-path") ?? "";
  // Public routes (sign-in) render with no stored data and no admin navigation.
  if (path !== "" && isPublicPath(path)) {
    return (
      <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        </head>
        <body className="min-h-dvh bg-page text-ink">
          <main className="mx-auto min-h-dvh max-w-xl px-4 py-10">{children}</main>
        </body>
      </html>
    );
  }
  const gate = await requireAdminPage();
  const csrf = await currentCsrf();
  const b = await budgetStatus();
  const row = (label: string, p: PeriodStatus): ShellSpendRow => ({ label, used: usd(p.usedMicros), reserved: usd(p.reservedMicros), remaining: usd(p.remainingMicros), cap: usd(p.limitMicros), ratio: p.limitMicros > 0 ? (p.usedMicros + p.reservedMicros) / p.limitMicros : 0 });
  const spend: ShellSpend = { label: "Spend budget", rows: [row("Today", b.day), row("Month", b.month)], note: IS_DEMO ? "Sample data, nothing charged." : undefined };
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <meta name="reviews-csrf" content={csrf} />
      </head>
      <body className="min-h-dvh bg-page text-ink">
        <AppShell
          appName="looot-reviews"
          githubHref="https://github.com/loootai/looot-reviews"
          nav={NAV}
          demoLabel={gate.policy.mode === "open-demo" ? "Demo, no sign-in. Invented shops and reviews" : IS_DEMO ? "Demo data, invented shops and reviews" : undefined}
          signOut={gate.policy.mode === "login"}
          spend={spend}
          primaryAction={{ href: "/new", label: "New pull" }}
        >
          <div className="mx-auto max-w-[1200px] px-4 py-6">{children}</div>
        </AppShell>
      </body>
    </html>
  );
}
