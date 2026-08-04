// 개요: React 데모 Vite 설정 — flowlensDev() 1줄로 브라우저 API 기록이 켜진다(개발 모드 전용).
import { flowlensDev } from "@flowlens/node/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), flowlensDev()],
  server: {
    port: 5173,
    // 백엔드(express-demo)로 프록시 — 같은 출처가 되어 트레이스 헤더가 안전하게 전달된다
    proxy: {
      "/inventory": "http://127.0.0.1:8300",
      "/orders": "http://127.0.0.1:8300",
    },
  },
});
