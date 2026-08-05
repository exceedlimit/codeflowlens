#!/usr/bin/env node
// 개요: `flowlens-ui` 실행 진입점 — 인자를 해석해 UI 서버를 띄운다.
// 로직: --db(기본 ./.flowlens/data.db), --port(기본 7411)를 읽고,
//       빌드된 웹 정적 파일과 함께 Fastify 서버를 listen한다.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildServer } from "./api.js";
import { detectScanners, inferProjectRoot } from "./scanner.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dbPath = resolve(arg("db", "./.flowlens/data.db"));
const port = Number(arg("port", "7411"));
const staticRoot = fileURLToPath(new URL("../web", import.meta.url));
const projectRoot = resolve(arg("project", inferProjectRoot(dbPath)));
const scanCommand = arg("scan-cmd", "");
const watch = !process.argv.includes("--no-watch");

const app = await buildServer({
  dbPath,
  staticRoot: existsSync(staticRoot) ? staticRoot : undefined,
  projectRoot,
  scanCommand: scanCommand || undefined,
  watch,
});

await app.listen({ port, host: "127.0.0.1" });
console.log(`FlowLens UI  →  http://127.0.0.1:${port}`);
console.log(`추적 DB: ${dbPath}${existsSync(dbPath) ? "" : " (아직 없음 — flowlens run으로 앱을 실행하면 생깁니다)"}`);
if (watch) {
  const scanners = detectScanners(projectRoot, { override: scanCommand || undefined });
  console.log(
    scanners.length > 0
      ? `코드 변경 감지: 켬 (${projectRoot}) — 저장하면 코드맵이 자동 갱신됩니다`
      : `코드 변경 감지: 켬 (${projectRoot}) — 단, 스캔 명령을 찾지 못했습니다.\n` +
        `  flowlens가 설치된 환경에서 UI를 띄우거나 --scan-cmd "<명령> scan"을 지정하세요`,
  );
}
