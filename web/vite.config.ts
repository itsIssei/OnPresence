import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = process.env.BACKEND_URL ?? "http://localhost:8080";

// Two production builds share dist/:
//   --mode admin  admin.html with React (big, behind login)
//   --mode site   index.html with Preact via preact/compat (small public page)
// Dev (`vite`) serves both pages with React.
export default defineConfig(({ command, mode }) => {
  const site = command === "build" && mode === "site";
  const pages: Record<string, string> = {};
  if (command !== "build" || site) pages.index = resolve(__dirname, "index.html");
  if (command !== "build" || !site) pages.admin = resolve(__dirname, "admin.html");
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        { find: "@", replacement: resolve(__dirname, "src") },
        ...(site
          ? [
              { find: /^react-dom\/test-utils$/, replacement: "preact/test-utils" },
              { find: /^react-dom\/client$/, replacement: "preact/compat/client" },
              { find: /^react-dom$/, replacement: "preact/compat" },
              { find: /^react\/jsx-runtime$/, replacement: "preact/jsx-runtime" },
              { find: /^react$/, replacement: "preact/compat" },
            ]
          : []),
      ],
    },
    server: {
      port: 5173,
      // The Go server owns the API, uploads, catalogs and link redirects.
      proxy: Object.fromEntries(["/api", "/uploads", "/data", "/fx", "/deco", "/dapp", "/go", "/healthz"].map((p) => [p, backend])),
    },
    build: {
      outDir: "dist",
      emptyOutDir: mode !== "site", // the admin build runs first and cleans
      sourcemap: false,
      rollupOptions: {
        input: pages,
      },
    },
  };
});
