import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["'Inter Tight'", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        ink: { 50: "#f7f7f8", 100: "#eeeef1", 200: "#d9d9e0", 300: "#b5b5c3", 400: "#8b8ba1", 500: "#6b6b82", 600: "#55556a", 700: "#3f3f50", 800: "#26262f", 900: "#16161c", 950: "#0d0d11" },
        acc: { DEFAULT: "#5b5bf6", soft: "#ececfe" },
        // sitio de Fullstack Ventures (fsvc.cl)
        fsv: { ink: "#111318", bg: "#F7F7F9", line: "#E5E7EB", violet: "#4B39FC", muted: "#5D6170" },
      },
    },
  },
  plugins: [],
} satisfies Config;
