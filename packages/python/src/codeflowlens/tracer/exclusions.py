"""
개요: "이 진입점은 더이상 추적하지 않음" 목록을 읽는 캐시.
로직: settings 테이블의 excluded_entries(JSON 배열)를 주기적으로(기본 10초) 다시 읽는다 —
      UI 설정 화면에서 바꾸면 실행 중인 앱에도 곧 반영된다.
참고: 읽기 실패 시 빈 목록으로 동작한다(fail-open — 추적이 더 되는 쪽이 안전).
"""

import json
import sqlite3
import time


class ExclusionList:
    """개요: 추적 제외 진입점 목록 (TTL 캐시)."""

    def __init__(self, db_path, ttl: float = 10.0):
        self._db_path = str(db_path)
        self._ttl = ttl
        self._entries = frozenset()
        self._loaded_at = 0.0

    def is_excluded(self, entry_name: str) -> bool:
        """개요: 이 진입점을 추적에서 제외해야 하는지 판정한다."""
        now = time.time()
        if now - self._loaded_at > self._ttl:
            self._reload()
            self._loaded_at = now
        return entry_name in self._entries

    def _reload(self):
        try:
            conn = sqlite3.connect(self._db_path, timeout=1.0)
            try:
                row = conn.execute(
                    "SELECT value FROM settings WHERE key='excluded_entries'"
                ).fetchone()
            finally:
                conn.close()
            parsed = json.loads(row[0]) if row else []
            self._entries = frozenset(parsed) if isinstance(parsed, list) else frozenset()
        except Exception:
            self._entries = frozenset()
