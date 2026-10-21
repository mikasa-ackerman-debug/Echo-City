/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  transpilePackages: ["@echo/engine", "@echo/protocol"],
  env: { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787" },
};
