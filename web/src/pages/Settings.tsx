// 设置页 — Bento × EVA-02 明日香：账本管理 + 关于 + 数据操作

import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import { Modal, toast } from '../components/ui';
import NERVBadge from '../components/NERVBadge';
import { getDashScopeKey, setDashScopeKey } from '../lib/qwenAsr';

export default function Settings() {
  const { ledger, ledgers, setLedger, refresh, bump } = useApp();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [asrKey, setAsrKey] = useState(getDashScopeKey());
  const [asrSaved, setAsrSaved] = useState(false);

  const create = async () => {
    if (!name.trim()) return toast('请输入账本名', 'err');
    try {
      const l = await api.createLedger(name.trim());
      await setLedger(l.id);
      toast('账本已创建并切换');
      setAdding(false);
      setName('');
      refresh();
    } catch (e) { toast(String((e as Error).message), 'err'); }
  };

  return (
    <div className="nike-in stack gap-6">

      <header className="card" style={{ padding: '26px 30px' }}>
        <div className="eyebrow eyebrow--black">SETTINGS / 设置 · EVA-02</div>
        <h1 className="hero-title" style={{ marginTop: 6, fontSize: 'clamp(1.6rem, 3vw, 2.4rem)' }}>
          偏好与账本
        </h1>
      </header>

      {/* 账本管理 */}
      <div className="card">
        <div className="row-between" style={{ marginBottom: 14 }}>
          <div>
            <div className="eyebrow eyebrow--black">LEDGERS / 账本管理 · EVA-02</div>
            <h3 className="section-title" style={{ marginTop: 4 }}>{ledgers.length} 个</h3>
          </div>
          <button className="btn btn--primary" onClick={() => setAdding(true)}>+ 新建账本</button>
        </div>
        <div className="stack gap-3">
          {ledgers.map((l) => (
            <div
              key={l.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 18px',
                borderRadius: 'var(--radius-md)',
                background: l.id === ledger?.id ? 'var(--primary)' : 'var(--surface)',
                color: l.id === ledger?.id ? '#fff' : 'var(--text)',
                boxShadow: l.id === ledger?.id ? 'var(--shadow-xs)' : 'var(--shadow-xs)',
              }}
            >
              <span style={{ fontSize: 20 }}>{l.id === ledger?.id ? '✓' : '○'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{l.name}</div>
                <div style={{ fontSize: 12, color: l.id === ledger?.id ? 'rgba(255,255,255,0.8)' : 'var(--text-secondary)', fontWeight: 500 }}>
                  {l.tx_count ?? 0} 笔交易 · {l.account_count ?? 0} 账户 · {l.category_count ?? 0} 分类
                </div>
              </div>
              {l.id !== ledger?.id && (
                <button className="btn btn--sm" style={{ background: '#fff', color: 'var(--text)' }} onClick={() => setLedger(l.id).then(bump)}>
                  切换
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 语音识别配置（千问 · 仅语音识别时联网） */}
      <div className="card">
        <div className="eyebrow eyebrow--black">QWEN ASR / 千问语音识别 · EVA-02</div>
        <h3 className="section-title" style={{ marginTop: 4 }}>语音记账引擎</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '10px 0 12px', lineHeight: 1.6 }}>
          在下面填入阿里云百炼 API Key（<code style={{ background: 'var(--surface)', padding: '2px 6px', borderRadius: 6 }}>DASHSCOPE_API_KEY</code>），
          即可在 APK 内联网使用语音记账。Key 仅保存在本机，
          <b>只有点语音识别时才联网</b>，其余记账/解析/抓取全部离线完成。不填则语音记账不可用。
        </p>
        <div className="stack gap-3">
          <input
            className="input"
            type="password"
            placeholder="sk-..."
            value={asrKey}
            onChange={(e) => { setAsrKey(e.target.value); setAsrSaved(false); }}
          />
          <div className="row" style={{ gap: 10, alignItems: 'center' }}>
            <button
              className="btn btn--primary"
              onClick={() => {
                setDashScopeKey(asrKey);
                setAsrSaved(true);
                toast(asrKey.trim() ? '千问语音识别已启用（Key 已保存到本机）' : '已清除语音识别 Key');
              }}
            >
              保存 Key
            </button>
            {asrSaved && <span className="chip chip--volt">✓ 已保存</span>}
            {!asrKey.trim() && (
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>未配置 —— 语音记账不可用</span>
            )}
          </div>
        </div>
      </div>

      {/* 关于 */}
      <div className="card card--black">
        <div className="row gap-3" style={{ marginBottom: 14, alignItems: 'center' }}>
          <NERVBadge size={48} />
          <div>
            <div className="eyebrow eyebrow--white">SPEC / 机体档案 · EVA-02</div>
            <h3 className="section-title" style={{ marginTop: 4 }}>Asuka记账 v1.2</h3>
          </div>
        </div>

        {/* 机体数据行（机体系仪表装饰） */}
        <div className="row gap-3" style={{ flexWrap: 'wrap', marginBottom: 14, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em' }}>
          <span className="chip chip--volt">MAGI 在线</span>
          <span className="chip chip--volt">AT 力场 稳定</span>
          <span className="chip chip--volt">同步率 100%</span>
          <span className="chip chip--volt">LCL 正常</span>
          <span className="chip" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>A.T. FIELD · ACTIVE</span>
        </div>

        {/* 规格表：标签 + 内容的两列布局 */}
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '8px 16px', fontSize: 13, color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>
          <Spec k="版本">Asuka记账 v1.2</Spec>
          <Spec k="主题">明日香 · Bento × EVA-02（红橙配色）</Spec>
          <Spec k="驾驶员">惣流・アスカ・ラングレー（EVA-02 PILOT · SYNC RATE 100%）</Spec>
          <Spec k="前端">React + TypeScript + Vite · 数字 JetBrains Mono</Spec>
          <Spec k="后端">本地 SQLite（asuka.db）· 金额以分存储 · 数据完全本地</Spec>
          <Spec k="核心">账本切换 · MAGI 自动抓取 · 二次确认删除 · 千问语音识别（仅语音联网）</Spec>
        </div>
      </div>

      {adding && (
        <Modal title="+ 新建账本 · EVA-02" onClose={() => setAdding(false)}>
          <div className="stack gap-3">
            <div>
              <label className="label">账本名称</label>
              <input
                className="input"
                autoFocus
                placeholder="例如：2026 年度账本"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && create()}
              />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn btn--ghost" onClick={() => setAdding(false)}>取消</button>
              <button className="btn btn--primary" onClick={create}>创建</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Spec({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <span
        style={{
          color: 'var(--eva-orange)', fontWeight: 700, fontSize: 11,
          letterSpacing: '0.08em', textTransform: 'uppercase', paddingTop: 2,
        }}
      >
        {k}
      </span>
      <span style={{ color: 'rgba(255,255,255,0.9)' }}>{children}</span>
    </>
  );
}
