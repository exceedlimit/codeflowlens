"""
개요: 표준 ast 모듈로 프로젝트의 함수/엔티티/호출관계를 추출하는 정적 분석기.
로직: 파일을 걸어다니며 파싱하고, 방문자가 함수·클래스 구조와 호출을 수집한 뒤,
      프로젝트 전체 심볼표로 호출을 function_id에 매칭한다.
참고: 못 푸는 동적 호출은 버린다(보수적) — 실행 기록(runtime edge)이 보완한다(PRD 8절).
      function_id는 추적기와 동일 규칙: '<상대경로>::<qualname>'.
"""

import ast
from dataclasses import dataclass, field
from pathlib import Path

from flowlens.analyzer.docparse import ParsedDoc, parse_doc
from flowlens.tracer.filter import EXCLUDED_DIR_NAMES

ENTITY_BASES = {"BaseModel", "Base", "DeclarativeBase", "SQLModel", "NamedTuple", "TypedDict"}
ENTITY_DECORATORS = {"dataclass"}


@dataclass
class ScanResult:
    """개요: 정적 분석 결과 묶음."""

    functions: list = field(default_factory=list)   # {id, file_path, qualified_name, line, doc, is_entity_method}
    entities: list = field(default_factory=list)    # {id, file_path, name, doc, fields:[{name,type,description}]}
    static_edges: set = field(default_factory=set)  # (caller_id, callee_id)
    usages: set = field(default_factory=set)        # (entity_id, function_id, role)
    relations: set = field(default_factory=set)     # (from_entity_id, to_entity_id)


class _FileVisitor(ast.NodeVisitor):
    """개요: 파일 하나에서 함수/클래스/호출을 수집하는 방문자."""

    def __init__(self, relpath: str):
        self.relpath = relpath
        self.stack = []          # (kind: 'class'|'func', name)
        self.functions = []      # 함수 dict + raw_calls(이름 목록)
        self.classes = []        # 클래스 dict (엔티티 후보)

    def _qualname(self, name: str) -> str:
        parts = []
        for kind, n in self.stack:
            parts.append(n if kind == "class" else n + ".<locals>")
        parts.append(name)
        return ".".join(parts)

    def _in_class(self):
        return self.stack and self.stack[-1][0] == "class"

    def visit_ClassDef(self, node: ast.ClassDef):
        qualname = self._qualname(node.name)
        bases = {_last_name(b) for b in node.bases}
        decorators = {_last_name(d) for d in node.decorator_list}
        fields = []
        for stmt in node.body:
            if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
                fields.append({
                    "name": stmt.target.id,
                    "type": _unparse(stmt.annotation),
                    "type_names": _identifiers(stmt.annotation),
                })
        self.classes.append({
            "name": node.name,
            "qualname": qualname,
            "line": node.lineno,
            "doc": parse_doc(ast.get_docstring(node)),
            "bases": bases,
            "decorators": decorators,
            "fields": fields,
        })
        self.stack.append(("class", node.name))
        self.generic_visit(node)
        self.stack.pop()

    def _visit_func(self, node):
        qualname = self._qualname(node.name)
        calls, self_calls = _collect_calls(node)
        params = {}
        for a in list(node.args.args) + list(node.args.kwonlyargs):
            if a.annotation is not None:
                params[a.arg] = _identifiers(a.annotation)
        self.functions.append({
            "id": f"{self.relpath}::{qualname}",
            "file_path": self.relpath,
            "qualified_name": qualname,
            "line": node.lineno,
            "doc": parse_doc(ast.get_docstring(node)),
            "is_entity_method": False,  # 엔티티 확정 후 채움
            "class_name": self.stack[-1][1] if self._in_class() else None,
            "raw_calls": calls,
            "raw_self_calls": self_calls,
            "param_types": params,
            "return_types": _identifiers(node.returns) if node.returns else set(),
        })
        self.stack.append(("func", node.name))
        self.generic_visit(node)
        self.stack.pop()

    visit_FunctionDef = _visit_func
    visit_AsyncFunctionDef = _visit_func


def _last_name(node) -> str:
    """개요: Name/Attribute 노드에서 마지막 이름 조각을 꺼낸다(예: a.b.C → C)."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Call):
        return _last_name(node.func)
    if isinstance(node, ast.Subscript):
        return _last_name(node.value)
    return ""


def _unparse(node) -> str:
    try:
        return ast.unparse(node)
    except Exception:
        return ""


def _identifiers(node) -> set:
    """개요: 타입 어노테이션 안의 모든 이름을 모은다(Optional[Order] → {Optional, Order})."""
    out = set()
    if node is None:
        return out
    for n in ast.walk(node):
        if isinstance(n, ast.Name):
            out.add(n.id)
        elif isinstance(n, ast.Attribute):
            out.add(n.attr)
        elif isinstance(n, ast.Constant) and isinstance(n.value, str):
            out.add(n.value)  # 문자열 전방 참조 "Order"
    return out


def _collect_calls(func_node):
    """
    개요: 함수 본문에서 호출된 이름들을 모은다.
    로직: f() → 이름, obj.m()/module.f() → 마지막 속성 이름, self.m() → self 표시와 함께.
    참고: 중첩 함수 내부 호출은 중첩 함수 자신의 것으로 계산되지만,
          단순화를 위해 본문 전체를 함께 수집한다(보수적 매칭이 걸러준다).
    """
    calls, self_calls = set(), set()
    for n in ast.walk(func_node):
        if not isinstance(n, ast.Call):
            continue
        f = n.func
        if isinstance(f, ast.Name):
            calls.add(f.id)
        elif isinstance(f, ast.Attribute):
            if isinstance(f.value, ast.Name) and f.value.id in ("self", "cls"):
                self_calls.add(f.attr)
            else:
                calls.add(f.attr)
    return calls, self_calls


def _is_entity(cls: dict) -> bool:
    """개요: 클래스가 엔티티(데이터 모델)인지 판정한다(PRD 3절 정의)."""
    if cls["bases"] & ENTITY_BASES or cls["decorators"] & ENTITY_DECORATORS:
        return True
    return False


def iter_python_files(root: Path):
    """개요: 제외 폴더를 피해 프로젝트의 .py 파일을 순회한다."""
    for path in sorted(root.rglob("*.py")):
        rel_parts = path.relative_to(root).parts
        if any(p in EXCLUDED_DIR_NAMES or p.startswith(".") for p in rel_parts[:-1]):
            continue
        yield path


def scan_project(root, exclude=()) -> ScanResult:
    """
    개요: 프로젝트 전체를 정적 분석해 ScanResult를 만든다.
    로직: 파일별로 방문자를 돌리고, 전체 심볼표를 만들어 호출/엔티티 참조를 id로 해석한다.
    """
    root = Path(root).resolve()
    result = ScanResult()
    all_funcs, all_classes = [], []

    for path in iter_python_files(root):
        relpath = str(path.relative_to(root))
        try:
            tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
        except SyntaxError:
            continue
        visitor = _FileVisitor(relpath)
        visitor.visit(tree)
        all_funcs.extend(visitor.functions)
        for c in visitor.classes:
            c["file_path"] = relpath
            all_classes.append(c)

    # --- 엔티티 확정 ---------------------------------------------------
    entities = [c for c in all_classes if _is_entity(c)]
    entity_by_name = {}
    for e in entities:
        eid = f"{e['file_path']}::{e['qualname']}"
        e["id"] = eid
        entity_by_name.setdefault(e["name"], []).append(eid)
        field_docs = e["doc"].fields
        result.entities.append({
            "id": eid,
            "file_path": e["file_path"],
            "name": e["name"],
            "doc": e["doc"],
            "line": e["line"],
            "fields": [
                {
                    "name": f["name"],
                    "type": f["type"],
                    "description": field_docs.get(f["name"]),
                }
                for f in e["fields"]
            ],
        })

    entity_names = set(entity_by_name)

    # --- 엔티티 간 관계(필드 타입 참조) ---------------------------------
    for e in entities:
        for f in e["fields"]:
            for ref in f["type_names"] & entity_names:
                for target in entity_by_name[ref]:
                    if target != e["id"]:
                        result.relations.add((e["id"], target))

    # --- 함수 확정 + 심볼표 ---------------------------------------------
    entity_class_names = {e["name"] for e in entities}
    by_simple_name = {}
    by_class_method = {}
    for f in all_funcs:
        f["is_entity_method"] = f["class_name"] in entity_class_names if f["class_name"] else False
        simple = f["qualified_name"].rsplit(".", 1)[-1]
        by_simple_name.setdefault(simple, []).append(f["id"])
        if f["class_name"]:
            by_class_method[(f["class_name"], simple)] = f["id"]
        result.functions.append({
            k: f[k] for k in
            ("id", "file_path", "qualified_name", "line", "doc", "is_entity_method")
        })

    # --- 호출 관계 매칭 (보수적) ----------------------------------------
    for f in all_funcs:
        for name in f["raw_calls"]:
            candidates = by_simple_name.get(name, [])
            target = None
            if len(candidates) == 1:
                target = candidates[0]
            elif len(candidates) > 1:
                same_file = [c for c in candidates if c.startswith(f["file_path"] + "::")]
                if len(same_file) == 1:
                    target = same_file[0]
            if target and target != f["id"]:
                result.static_edges.add((f["id"], target))
        for name in f["raw_self_calls"]:
            target = by_class_method.get((f["class_name"], name))
            if target and target != f["id"]:
                result.static_edges.add((f["id"], target))

    # --- 함수의 엔티티 사용 ---------------------------------------------
    for f in all_funcs:
        used_param = set()
        for names in f["param_types"].values():
            used_param |= names & entity_names
        for name in used_param:
            for eid in entity_by_name[name]:
                result.usages.add((eid, f["id"], "param"))
        for name in f["return_types"] & entity_names:
            for eid in entity_by_name[name]:
                result.usages.add((eid, f["id"], "return"))

    return result
