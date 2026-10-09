"use client";

import { Moon, Sun } from "lucide-react";

/** Flips the saved theme between light and dark. */
export function ThemeToggle() {
  function flip() {
    const dark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {}
  }
  return (
    <button type="button" onClick={flip} aria-label="Toggle theme" className="grid size-8 place-items-center rounded-control text-mute hover:bg-hover hover:text-ink">
      <Sun size={16} className="hidden dark:block" />
      <Moon size={16} className="dark:hidden" />
    </button>
  );
}
