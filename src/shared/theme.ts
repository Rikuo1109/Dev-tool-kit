export interface PanelTheme {
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentSoft: string;
  success: string;
  successSoft: string;
  warn: string;
  warnSoft: string;
  error: string;
  errorSoft: string;
  barTrack: string;
  shadow: string;
}

export function getPanelTheme(isDark: boolean): PanelTheme {
  return isDark
    ? {
        bg: "#0f1117",
        surface: "#181b24",
        border: "#2a3142",
        text: "#e8eaef",
        muted: "#8b93a7",
        accent: "#6366f1",
        accentSoft: "rgba(99, 102, 241, 0.15)",
        success: "#22c55e",
        successSoft: "rgba(34, 197, 94, 0.15)",
        warn: "#f59e0b",
        warnSoft: "rgba(245, 158, 11, 0.15)",
        error: "#ef4444",
        errorSoft: "rgba(239, 68, 68, 0.15)",
        barTrack: "#252a38",
        shadow: "0 8px 32px rgba(0,0,0,0.35)",
      }
    : {
        bg: "#f4f6fb",
        surface: "#ffffff",
        border: "#e2e6ef",
        text: "#1a1d26",
        muted: "#5c6478",
        accent: "#4f46e5",
        accentSoft: "rgba(79, 70, 229, 0.1)",
        success: "#16a34a",
        successSoft: "rgba(22, 163, 74, 0.1)",
        warn: "#d97706",
        warnSoft: "rgba(217, 119, 6, 0.1)",
        error: "#dc2626",
        errorSoft: "rgba(220, 38, 38, 0.1)",
        barTrack: "#eef1f7",
        shadow: "0 8px 32px rgba(15, 23, 42, 0.08)",
      };
}
