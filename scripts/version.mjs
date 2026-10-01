#!/usr/bin/env node
// 개요: 배포 버전 관리 — 세 패키지(PyPI codeflowlens, npm @codeflowlens/node·ui)의 버전을 한 번에 바꾸고 검사한다.
// 로직: set은 _version.py와 두 package.json·package-lock.json을 같은 버전으로 고치고,
//       check는 세 버전이 같은지(태그를 주면 태그와도 같은지) 확인해 어긋나면 종료코드 1로 끝난다.
// 참고: 태그(vX.Y.Z) 하나로 세 패키지를 함께 배포하므로 GitHub Actions 배포 전에 check가 먼저 돈다.
//
// 사용법:
//   node scripts/version.mjs set 0.1.1        # 세 패키지 버전 변경
//   node scripts/version.mjs check            # 세 버전이 같은지 확인
//   node scripts/version.mjs check v0.1.1     # 태그와도 같은지 확인
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const PY_VERSION_FILE = "packages/python/src/codeflowlens/_version.py";
const NPM_PACKAGES = ["node", "ui"];

/** 개요: 세 패키지의 현재 버전을 읽는다. */
export function readVersions(root) {
  const py = readFileSync(path.join(root, PY_VERSION_FILE), "utf-8");
  const m = py.match(/__version__\s*=\s*["']([^"']+)["']/);
  const out = { python: m ? m[1] : null };
  for (const pkg of NPM_PACKAGES) {
    out[pkg] = JSON.parse(readFileSync(path.join(root, "packages", pkg, "package.json"), "utf-8")).version;
  }
  return out;
}

/**
 * 개요: 버전이 어긋난 곳을 찾아 문제 목록을 돌려준다(문제가 없으면 빈 배열).
 * 참고: tag는 "v0.1.1" 또는 "0.1.1" 형식 모두 받는다.
 */
export function checkVersions(root, tag) {
  const v = readVersions(root);
  const problems = [];
  const values = new Set(Object.values(v));
  if (values.size !== 1) {
    problems.push(`패키지 버전이 서로 다릅니다: ${JSON.stringify(v)}`);
  }
  if (tag) {
    const want = tag.replace(/^v/, "");
    for (const [name, ver] of Object.entries(v)) {
      if (ver !== want) problems.push(`${name} 버전(${ver})이 태그(${tag})와 다릅니다`);
    }
  }
  return problems;
}

/** 개요: JSON 파일을 읽어 고친 뒤, 원래 형식(들여쓰기 2칸 + 끝 줄바꿈)으로 다시 쓴다. */
function editJson(file, edit) {
  if (!existsSync(file)) return;
  const data = JSON.parse(readFileSync(file, "utf-8"));
  edit(data);
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

/** 개요: 세 패키지의 버전(과 lock 파일의 자기 버전)을 한 번에 바꾼다. */
export function setVersion(root, version) {
  if (!SEMVER.test(version)) {
    throw new Error(`버전 형식이 올바르지 않습니다: "${version}" (예: 0.1.1)`);
  }
  const pyFile = path.join(root, PY_VERSION_FILE);
  writeFileSync(pyFile, `__version__ = "${version}"\n`);
  for (const pkg of NPM_PACKAGES) {
    const dir = path.join(root, "packages", pkg);
    editJson(path.join(dir, "package.json"), (d) => { d.version = version; });
    editJson(path.join(dir, "package-lock.json"), (d) => {
      d.version = version;
      if (d.packages && d.packages[""]) d.packages[""].version = version;
    });
  }
}

/** 개요: 명령줄 진입점 — set / check 를 실행한다. */
function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [cmd, arg] = argv;
  if (cmd === "set" && arg) {
    setVersion(root, arg.replace(/^v/, ""));
    console.log(`버전을 ${arg.replace(/^v/, "")}(으)로 바꿨습니다:`, readVersions(root));
    return 0;
  }
  if (cmd === "check") {
    const problems = checkVersions(root, arg);
    if (problems.length) {
      for (const p of problems) console.error(`✗ ${p}`);
      return 1;
    }
    console.log(`✓ 버전 일치: ${readVersions(root).python}${arg ? ` (태그 ${arg})` : ""}`);
    return 0;
  }
  console.error("사용법: node scripts/version.mjs set <버전> | check [태그]");
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
