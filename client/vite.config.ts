import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendOrigin = process.env.VITE_BACKEND_ORIGIN ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/health": backendOrigin,
      "/auth": backendOrigin,
      "/defs": backendOrigin,
      "/rooms": backendOrigin,
      "/rounds": backendOrigin,
      "/transit": backendOrigin,
      "/uploads": backendOrigin,
      "/api": backendOrigin,
      "/ws": {
        target: backendOrigin,
        ws: true,
      },
    },
  },
});
