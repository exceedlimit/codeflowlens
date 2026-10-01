"""개요: 추적기 테스트 대상이 되는 예제 코드 모음."""

import asyncio
import json
import threading


def inner(x, y):
    """개요: 두 수를 더한다."""
    return x + y


def outer(n):
    """개요: inner를 두 번 호출해 합계를 만든다."""
    total = 0
    for _ in range(2):
        total = inner(total, n)
    return total


def boom():
    """개요: 일부러 예외를 낸다."""
    raise ValueError("bad")


def call_boom():
    """개요: 예외를 잡아서 처리한다."""
    try:
        boom()
    except ValueError:
        return "caught"


def uses_stdlib():
    """개요: 표준 라이브러리를 호출한다(추적 제외 확인용)."""
    return json.dumps({"a": 1})


def thread_work():
    """개요: 스레드 안에서 실행되는 작업."""
    return inner(1, 2)


def run_in_thread():
    """개요: 스레드를 만들어 작업을 실행한다."""
    t = threading.Thread(target=thread_work)
    t.start()
    t.join()
    return True


def helper(x):
    """개요: 값을 두 배로 만든다."""
    return x * 2


async def fetch(x):
    """개요: 비동기로 값을 가져와 가공한다(await 뒤 호출의 부모 연결 확인용)."""
    await asyncio.sleep(0)
    return helper(x)


async def main_async():
    """개요: 비동기 진입점."""
    return await fetch(21)


def run_async():
    """개요: 비동기 흐름을 실행한다."""
    return asyncio.run(main_async())


async def fetch_fail(x):
    """개요: await 뒤에 실패하는 비동기 작업(예외 종료 판정 확인용)."""
    await asyncio.sleep(0)
    helper(x)
    raise ValueError("async bad")


async def main_async_fail():
    """개요: 실패하는 비동기 작업을 잡아 처리한다."""
    try:
        await fetch_fail(1)
    except ValueError:
        return "caught"


def run_async_fail():
    """개요: 실패하는 비동기 흐름을 실행한다."""
    return asyncio.run(main_async_fail())


def gen_values(n):
    """개요: 값을 하나씩 만들어 낸다(제너레이터 일시중단 판정 확인용)."""
    for i in range(n):
        yield helper(i)


def run_gen():
    """개요: 제너레이터를 끝까지 소비한다."""
    return list(gen_values(3))
