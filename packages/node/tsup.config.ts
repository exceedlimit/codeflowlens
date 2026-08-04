// 개요: 빌드 설정 — ESM 산출물 + register 진입점 + 스키마 사본 복사.
import { copyFileSync, mkdirSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      cli: "src/cli.ts",
      register: "src/register.mts",
      hooks: "src/hooks.mts",
      runtime: "src/runtime.ts",
      "vite-plugin": "src/vite-plugin.ts",
    },
    format: ["esm"],
    outExtension: ({ format }) => ({ js: format === "esm" ? ".mjs" : ".js" }),
    dts: false,
    clean: true,
    sourcemap: false,
    splitting: true,
    external: ["better-sqlite3", "@babel/core", "ts-morph"],
    onSuccess: async () => {
      mkdirSync("dist/db", { recursive: true });
      copyFileSync("src/db/schema.sql", "dist/db/schema.sql");
      // bin은 .js 확장자를 기대하므로 cli만 이름 유지
      copyFileSync("dist/cli.mjs", "dist/cli.js");
    },
  },
  {
    // 브라우저 주입용 단일 파일 (iife) — Vite 플러그인이 인라인으로 읽는다
    entry: { browser: "src/browser.ts" },
    format: ["iife"],
    dts: false,
    clean: false,
    sourcemap: false,
    minify: true,
    platform: "browser",
  },
]);
