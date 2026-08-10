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
    // ledgers() 与 activeLedger() 解耦：删光账本后 activeLedger 会 reject，
    // 若用 Promise.all 会连累 ledgers() 更新 → UI 列表不刷新（账本显示还在，实际已删）
    try {
      const ls = await api.ledgers();
      setLedgers(ls);
    } catch {
      // 后端不可用时静默
    }
    try {
      const active = await api.activeLedger();
      setLedgerState(active);
    } catch {
      setLedgerState(null); // 无激活账本（如删光）→ 置空，由页面显示空状态
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
