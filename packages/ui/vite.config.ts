// 개요: 웹 UI 빌드/개발서버 설정. 개발 중엔 /api를 UI 서버(7411)로 프록시한다.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/web" },
  server: {
    port: 5411,
    proxy: { "/api": "http://127.0.0.1:7411" },
  },
});
