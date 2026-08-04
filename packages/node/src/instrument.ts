// 개요: 바벨로 함수 본문을 __flowlens.wrap()으로 감싸는 계측 변환기.
// 로직: 모듈 로드 시점에 메모리에서만 적용 — 디스크 원본은 불변(PRD G2 코드 오염 0).
//       본문을 화살표 함수로 빼내 wrap에 넘긴다(화살표는 this/arguments/super를 상속해 안전).
// 참고: 제너레이터·생성자·접근자는 v1 미계측. 파싱 실패 시 null(원본 사용, fail-open).
import * as babel from "@babel/core";
import type { NodePath, types as t } from "@babel/core";
// 이름(문자열)으로 넘기면 사용자 프로젝트 cwd에서 찾으려다 실패한다 — 모듈을 직접 넘긴다
import presetTypescript from "@babel/preset-typescript";

const MARKER = "/*__flowlens_instrumented__*/";

type FnPath = NodePath<
  t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression | t.ClassMethod | t.ObjectMethod
>;

/** 개요: 함수의 표시 이름(qualname)을 알아낸다. 메서드는 Class.method 형식. */
function qualnameOf(path: FnPath, types: typeof t): string | null {
  const node = path.node;
  if (types.isClassMethod(node) || types.isObjectMethod(node)) {
    const key = node.key;
    const name = types.isIdentifier(key) ? key.name
      : types.isStringLiteral(key) ? key.value : null;
    if (!name) return null;
    if (types.isClassMethod(node)) {
      const cls = path.findParent((p) => p.isClassDeclaration() || p.isClassExpression());
      const clsId = cls && (cls.node as t.ClassDeclaration).id;
      return clsId ? `${clsId.name}.${name}` : name;
    }
    return name;
  }
  if (types.isFunctionDeclaration(node)) return node.id?.name ?? null;
  // const f = () => {} / const f = function() {}
  const parent = path.parent;
  if (types.isVariableDeclarator(parent) && types.isIdentifier(parent.id)) return parent.id.name;
  if (types.isAssignmentExpression(parent) && types.isMemberExpression(parent.left)
      && types.isIdentifier(parent.left.property)) return parent.left.property.name;
  if (types.isObjectProperty(parent) && types.isIdentifier(parent.key)) return parent.key.name;
  if (types.isFunctionExpression(node) && node.id) return node.id.name;
  return null; // 익명 콜백은 계측하지 않는다(노이즈 방지)
}

/**
 * 개요: 소스 하나를 계측한 결과를 돌려준다. 실패하면 null(호출부가 원본을 쓴다).
 */
export function instrument(source: string, relpath: string): string | null {
  if (source.startsWith(MARKER)) return source; // 이중 계측 방지
  try {
    const generated = new WeakSet<object>();
    const plugin = ({ types }: { types: typeof t }): babel.PluginObj => ({
      visitor: {
        "FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ClassMethod|ObjectMethod"(
          rawPath,
        ) {
          const path = rawPath as unknown as FnPath;
          const node = path.node;
          if (generated.has(node)) return;
          if (node.generator) return;
          if (types.isClassMethod(node) &&
              (node.kind === "constructor" || node.kind === "get" || node.kind === "set")) return;
          const name = qualnameOf(path, types);
          if (!name) return;
          const fid = `${relpath}::${name}`;

          // 인자 캡처: 단순 식별자 파라미터만 {a: a, b: b}로
          const argProps: t.ObjectProperty[] = [];
          for (const p of node.params) {
            if (types.isIdentifier(p)) {
              argProps.push(types.objectProperty(types.identifier(p.name), types.identifier(p.name)));
            } else if (types.isAssignmentPattern(p) && types.isIdentifier(p.left)) {
              argProps.push(types.objectProperty(types.identifier(p.left.name), types.identifier(p.left.name)));
            }
          }

          const origBody = node.body;
          const bodyFn = types.arrowFunctionExpression(
            [],
            types.isBlockStatement(origBody) ? origBody : origBody as t.Expression,
            node.async,
          );
          generated.add(bodyFn);

          const bodyId = path.scope.generateUidIdentifier("flowlens_body");
          const wrapCall = types.conditionalExpression(
            types.memberExpression(types.identifier("globalThis"), types.identifier("__flowlens")),
            types.callExpression(
              types.memberExpression(
                types.memberExpression(types.identifier("globalThis"), types.identifier("__flowlens")),
                types.identifier("wrap"),
              ),
              [
                types.stringLiteral(fid),
                types.stringLiteral(name),
                types.objectExpression(argProps),
                bodyId,
              ],
            ),
            types.callExpression(bodyId, []),
          );
          const newBody = types.blockStatement([
            types.variableDeclaration("const", [types.variableDeclarator(bodyId, bodyFn)]),
            types.returnStatement(wrapCall),
          ]);
          node.body = newBody;
          if (types.isArrowFunctionExpression(node)) {
            // 표현식 본문 화살표도 블록 본문이 되었다
            (node as t.ArrowFunctionExpression).body = newBody;
          }
        },
      },
    });

    const isTs = /\.(m|c)?tsx?$/.test(relpath);
    const result = babel.transformSync(source, {
      filename: relpath,
      // TS 소스(Node 네이티브 실행 또는 tsx 체인의 원시 단계)는 타입을 함께 벗겨 JS로 만든다
      presets: isTs ? [[presetTypescript, {}]] : [],
      plugins: [plugin],
      parserOpts: { sourceType: "unambiguous", allowReturnOutsideFunction: true },
      generatorOpts: { retainLines: true },
      babelrc: false,
      configFile: false,
      compact: false,
    });
    if (!result?.code) return null;
    return MARKER + result.code;
  } catch {
    return null;
  }
}
