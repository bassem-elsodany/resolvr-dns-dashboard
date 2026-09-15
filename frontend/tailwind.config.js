/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Theme-aware — src/assets/styles.css defines the CSS variables
        // these read (light defaults on bare :root, dark overrides under
        // prefers-color-scheme and [data-theme="dark"]). `<alpha-value>`
        // keeps opacity modifiers like `bg-background-card/50` working.
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        background: {
          canvas: "rgb(var(--color-bg-canvas) / <alpha-value>)",
          sidebar: "rgb(var(--color-bg-sidebar) / <alpha-value>)",
          card: "rgb(var(--color-bg-card) / <alpha-value>)",
          elevated: "rgb(var(--color-bg-elevated) / <alpha-value>)",
          hover: "rgb(var(--color-bg-hover) / <alpha-value>)",
        },
        border: {
          DEFAULT: "rgb(var(--color-border) / <alpha-value>)",
          hover: "rgb(var(--color-border-hover) / <alpha-value>)",
        },
        ring: {
          hairline: "rgb(var(--color-ring) / <alpha-value>)",
        },
        fg: {
          DEFAULT: "rgb(var(--color-fg) / <alpha-value>)",
        },
        gray: {
          300: "rgb(var(--color-gray-300) / <alpha-value>)",
          400: "rgb(var(--color-gray-400) / <alpha-value>)",
          500: "rgb(var(--color-gray-500) / <alpha-value>)",
          600: "rgb(var(--color-gray-600) / <alpha-value>)",
        },
        // Semantic status colors — separate from the accent hue, used for
        // query-response classification and health states across the app.
        ok: "rgb(var(--color-ok) / <alpha-value>)",
        warn: "rgb(var(--color-warn) / <alpha-value>)",
        crit: "rgb(var(--color-crit) / <alpha-value>)",
        info: "rgb(var(--color-info) / <alpha-value>)",
        cache: "rgb(var(--color-cache) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        lg: "0.5rem",
      },
    },
  },
  plugins: [],
}
