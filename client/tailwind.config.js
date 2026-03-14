/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#f8f6f1",
        ink: "#1a1b1e",
        accent: "#006d77",
        signal: "#d1495b",
      },
      fontFamily: {
        heading: ["'Space Grotesk'", "sans-serif"],
        body: ["'IBM Plex Sans'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      boxShadow: {
        soft: "0 12px 38px rgba(0, 0, 0, 0.08)",
      },
    },
  },
  plugins: [],
};
