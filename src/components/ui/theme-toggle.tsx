"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";

const ORDER = ["system", "light", "dark"] as const;
type Mode = (typeof ORDER)[number];
const ICONS = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };

/** Cycles system → light → dark. Renders the system icon until mounted so the
 * server and first client render agree (next-themes reads localStorage). */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const current: Mode = mounted && ORDER.includes(theme as Mode) ? (theme as Mode) : "system";
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const Icon = ICONS[current];

  return (
    <button
      type="button"
      title={`theme: ${current} — switch to ${next}`}
      onClick={() => setTheme(next)}
      className="text-muted-foreground transition-colors hover:text-foreground"
    >
      <Icon className="size-4" />
    </button>
  );
}
