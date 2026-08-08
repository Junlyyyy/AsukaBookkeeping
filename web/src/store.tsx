// 全局状态 — 当前账本 + 数据刷新

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
import type { Ledger } from './types';

interface AppState {
  ledger: Ledger | null;
  ledgers: Ledger[];
  refresh: () => Promise<void>;
  setLedger: (id: number) => Promise<void>;
  bump: () => void; // 轻量刷新信号（数据变更后触发，不重拉账本）
  tick: number;
}

const Ctx = createContext<AppState>({
  ledger: null, ledgers: [], refresh: async () => {}, setLedger: async () => {}, bump: () => {}, tick: 0,
});

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ledger, setLedgerState] = useState<Ledger | null>(null);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [ls, active] = await Promise.all([api.ledgers(), api.activeLedger()]);
      setLedgers(ls);
      setLedgerState(active);
    } catch {
      // 后端不可用时静默
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const setLedger = useCallback(async (id: number) => {
    await api.setActiveLedger(id);
    await refresh();
    setTick((t) => t + 1);
  }, [refresh]);

  const bump = useCallback(() => setTick((t) => t + 1), []);

  return (
    <Ctx.Provider value={{ ledger, ledgers, refresh, setLedger, bump, tick }}>
      {children}
    </Ctx.Provider>
  );
}

export const useApp = () => useContext(Ctx);
