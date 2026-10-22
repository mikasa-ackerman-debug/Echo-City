/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // @echo/agents is only imported through its pure "./bots" entry (browser practice arena); never the network adapters.
  transpilePackages: ["@echo/engine", "@echo/protocol", "@echo/agents", "@echo/exam"],
  env: { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787" },
};
