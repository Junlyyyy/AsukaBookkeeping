// 语音记账 Modal — 明日香风格：点击"记一笔"→ 语音识别（豆包流式语音识别大模型，联网）→ 自动生成记账
// 识别文本 → 复用 /transactions/parse（豆包 / 规则引擎）→ 记账
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import { Modal, toast, fmtMoney } from './ui';
import {
  onVoiceState, startVoice, stopVoice, clearVoice, detectMode, type VoiceState,
} from '../lib/voice';

export default function VoiceRecorder({ onClose, onSaved }: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { ledger } = useApp();
  const [state, setState] = useState<VoiceState>({
    supported: false, mode: 'none', listening: false, interim: '', final: '', error: null,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const off = onVoiceState(setState);
    (async () => {
      const m = await detectMode();
      if (m !== 'cloud-asr') {
        setState((s) => ({
          ...s,
          supported: false,
          mode: 'none',
          error: '语音识别未启用：需在后端配置千问语音识别大模型（环境变量 DASHSCOPE_API_KEY）。详见 TESTING_AND_BUILD.md。',
        }));
        return;
      }
      void startVoice();
    })();
    return () => { off(); clearVoice(); };
  }, []);

  const fullText = (state.final + state.interim).trim();

  // 识别完成自动解析（转写完成后 final 已落库且停止聆听）
  useEffect(() => {
    if (!state.listening && state.final && !saving) {
      void parseAndSave(state.final);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.listening, state.final]);

  const parseAndSave = async (text: string) => {
    if (!ledger) return;
    if (saving) return;
    setSaving(true);
    try {
      const r = await api.parseTransaction(text, ledger.id);
      const parsed = (r as { parsed?: { amount?: number; category?: string | null; engine?: string } }).parsed;
      const amt = parsed?.amount ?? r.amount;
      const cat = parsed?.category;
      const eng = parsed?.engine === 'doubao' ? '豆包' : parsed?.engine === 'rule' ? '规则' : '';
      toast(`已记账：¥${fmtMoney(amt).replace('¥', '')}${cat ? ` · ${cat}` : ''}${eng ? `（${eng}解析）` : ''}`);
      onSaved();
      onClose();
    } catch (e) {
      toast(`语音内容无法识别金额：「${text.slice(0, 20)}」请说「XX元 干什么」`, 'err');
      setSaving(false);
    }
  };

  const handleStop = async () => {
    const text = await stopVoice();
    if (!text) { toast('未识别到语音内容', 'err'); return; }
    await parseAndSave(text);
  };

  const canListen = state.supported && !state.listening;

  return (
    <Modal title="🎙️ 语音记账 · あんたバカ？直接说就行" onClose={onClose} wide>
      {/* 引擎标识：联网千问语音大模型 */}
      <div className="eva-pilot-badge eva-pilot-badge--ghost" style={{ marginBottom: 12 }}>
        QWEN ASR · 千问语音识别大模型（Paraformer）· 联网识别 · 免费 10h/月
      </div>
      {/* 波形指示 */}
      <div style={{ textAlign: 'center', padding: '20px 0 24px' }}>
        <div
          style={{
            width: 96, height: 96, margin: '0 auto 16px', borderRadius: '50%',
            background: state.listening
              ? 'radial-gradient(circle, var(--eva-red-tint), rgba(211,41,15,0.25))'
              : 'var(--gray-50)',
            border: `2px solid ${state.listening ? 'var(--eva-red)' : 'var(--gray-200)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 40, boxShadow: state.listening ? 'var(--eva-glow-red)' : 'none',
            animation: state.listening ? 'pulse-ring 1.2s ease infinite' : 'none',
          }}
        >
          {state.listening ? '🔴' : '🎙️'}
        </div>
        <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>
          {saving ? '记账中…' : state.listening ? '正在聆听…' : fullText ? '识别完成' : '准备就绪'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
          {state.listening
            ? '说一句话后自动停止，例如「昨天星巴克咖啡38块」'
            : fullText ? '点击「确认记账」保存结果' : '点击「开始聆听」说话'}
        </div>
      </div>

      {/* 实时转录 */}
      <div className="panel-inset" style={{ marginBottom: 16, minHeight: 64 }}>
        <div className="eyebrow eyebrow--black" style={{ marginBottom: 6 }}>TRANSCRIPT / 转录</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text)', minHeight: 26 }}>
          {fullText || <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>{state.listening ? '聆听中…' : '等待语音输入…'}</span>}
          {state.listening && <span style={{ display: 'inline-block', width: 10, height: 18, background: 'var(--eva-red)', marginLeft: 3, verticalAlign: 'text-bottom', animation: 'cursor-blink 1s step-end infinite' }} />}
        </div>
      </div>

      {state.error && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'rgba(220,38,38,0.08)', color: 'var(--danger)', fontSize: 13, fontWeight: 500 }}>
          ⚠ {state.error}
        </div>
      )}

      <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn btn--ghost" onClick={onClose}>取消</button>
        <button className="btn btn--ghost" onClick={() => void startVoice()} disabled={!canListen}>
          重新听
        </button>
        <button className="btn btn--primary" onClick={() => void handleStop()} disabled={(!fullText && !state.listening) || saving}>
          {state.listening ? '停止并记账' : saving ? '记账中…' : '确认记账'}
        </button>
      </div>

      <style>{`
        @keyframes pulse-ring {
          0% { box-shadow: 0 0 0 0 rgba(211,41,15,0.4); }
          70% { box-shadow: 0 0 0 18px rgba(211,41,15,0); }
          100% { box-shadow: 0 0 0 0 rgba(211,41,15,0); }
        }
        @keyframes cursor-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </Modal>
  );
}
