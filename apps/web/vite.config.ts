import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Resolve workspace packages to their TypeScript source: edit the engine, see it live.
  resolve: { conditions: ["source", "module", "browser", "development|production"] },
  worker: { format: "es" },
  server: { port: 5173, strictPort: true },
});
