// 개요: 코드맵 갱신 상태를 화면 전체가 공유하도록 담는 컨텍스트.
// 로직: 3초마다 서버 상태를 물어보고, 갱신 시각이 바뀌면 각 화면이 데이터를 다시 불러온다.
import React, {
  createContext, useCallback, useContext, useEffect, useState,
} from "react";

export interface ScanStatus {
  scanning: boolean;
  lastScanAt: number | null;
  watching: boolean;
  projectRoot: string;
  lastResult: { ok: boolean; message: string } | null;
}

interface ScanContextValue extends ScanStatus {
  /** 지금 갱신 — 완료되면 결과 메시지를 돌려준다 */
  scanNow: () => Promise<string>;
}

const EMPTY: ScanStatus = {
  scanning: false, lastScanAt: null, watching: false, projectRoot: "", lastResult: null,
};

const ScanContext = createContext<ScanContextValue>({ ...EMPTY, scanNow: async () => "" });

export function ScanStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<ScanStatus>(EMPTY);

  const refresh = useCallback(async () => {
    try {
      setStatus(await (await fetch("/api/scan/status")).json());
    } catch {
      /* UI 서버 응답 없음 — 이전 상태 유지 */
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  const scanNow = useCallback(async () => {
    setStatus((s) => ({ ...s, scanning: true }));
    try {
      const body = await (await fetch("/api/scan", { method: "POST" })).json();
      if (body.status) setStatus(body.status);
      return body.message as string;
    } catch (e) {
      return String(e);
    } finally {
      refresh();
    }
  }, [refresh]);

  return (
    <ScanContext.Provider value={{ ...status, scanNow }}>{children}</ScanContext.Provider>
  );
}

export function useScanStatus(): ScanContextValue {
  return useContext(ScanContext);
}
