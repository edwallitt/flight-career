/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Operations-room palette: deep midnight base, hairline rules, single
        // amber accent used like cockpit-glass phosphor.
        ink: {
          900: "#070910",
          850: "#0a0d14",
          800: "#0f131c",
          750: "#141823",
          700: "#1a1f2c",
          600: "#222836",
          500: "#2c3341",
        },
        bg: {
          DEFAULT: "#0a0d14",
          elevated: "#141823",
          surface: "#0f131c",
        },
        muted: {
          DEFAULT: "#7d8595",
          dim: "#5b6172",
          faint: "#3f4554",
        },
        text: {
          DEFAULT: "#dfe2e9",
          high: "#f1f3f7",
        },
        amber: {
          glow: "#d4a574",
          warm: "#e6b885",
          deep: "#a07a4a",
          dim: "#6b5235",
        },
        urgency: {
          critical: "#e15c4f",
          urgent: "#e8a04c",
          standard: "#7d8595",
          flexible: "#5b6172",
        },
      },
      fontFamily: {
        sans: ["IBM Plex Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: [
          "IBM Plex Mono",
          "ui-monospace",
          "SFMono-Regular",
          "monospace",
        ],
        display: [
          "IBM Plex Sans Condensed",
          "IBM Plex Sans",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      letterSpacing: {
        callsign: "0.18em",
        wide2: "0.08em",
      },
      fontSize: {
        micro: ["0.6875rem", { lineHeight: "1rem" }],
        tiny: ["0.75rem", { lineHeight: "1.05rem" }],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(212, 165, 116, 0.45), 0 0 20px -6px rgba(212, 165, 116, 0.35)",
        inset: "inset 0 1px 0 rgba(255,255,255,0.03)",
      },
    },
  },
  plugins: [],
};
