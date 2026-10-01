"""
개요: 파이썬 버전에 맞는 추적 백엔드를 고른다.
로직: 3.12+는 sys.monitoring(저오버헤드), 그 이전은 sys.settrace를 쓴다.
"""

import sys


def select_backend(session):
    """개요: 현재 파이썬 버전에 맞는 백엔드 인스턴스를 만든다."""
    if sys.version_info >= (3, 12):
        from codeflowlens.tracer.backend_monitoring import MonitoringBackend
        return MonitoringBackend(session)
    from codeflowlens.tracer.backend_settrace import SettraceBackend
    return SettraceBackend(session)
