// 语音记账 Modal — 既可语音识别（千问），也可手动输入；识别结果可二次编辑
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
  /** 识别结果 + 用户手动输入合并的最终文本（识别完成自动填入，可编辑） */
  const [text, setText] = useState('');
  /** 是否已从识别结果自动填充过，避免覆盖用户已编辑的内容 */
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    const off = onVoiceState(setState);
    (async () => {
      const m = await detectMode();
      if (m !== 'cloud-asr') {
        setState((s) => ({
          ...s,
          supported: false,
          mode: 'none',
          error: '语音识别未启用：请到「设置」页填入阿里云百炼 API Key（DASHSCOPE_API_KEY）—— 仅语音识别时联网，其余功能完全离线。',
        }));
        return;
      }
      void startVoice();
    })();
    return () => { off(); clearVoice(); };
  }, []);

  const interimText = (state.final + state.interim).trim();

  // 识别完成后一次性回填到编辑框（用户可继续修改）
  useEffect(() => {
    if (!state.listening && state.final && !filled) {
      setText(state.final.trim());
      setFilled(true);
    }
  }, [state.listening, state.final, filled]);

  const parseAndSave = async (raw: string) => {
    const useText = raw.trim();
    if (!ledger) return;
    if (saving) return;
    if (!useText) return toast('请先说话或输入内容', 'err');
    setSaving(true);
    try {
      const r = await api.parseTransaction(useText, ledger.id);
      const parsed = (r as { parsed?: { amount?: number; category?: string | null; engine?: string } }).parsed;
      const amt = parsed?.amount ?? r.amount;
      const cat = parsed?.category;
      const eng = parsed?.engine === 'qwen' ? '千问' : parsed?.engine === 'deepseek' ? 'DeepSeek' : parsed?.engine === 'doubao' ? '豆包' : parsed?.engine === 'rule' ? '规则' : '';
      toast(`已记账：¥${fmtMoney(amt).replace('¥', '')}${cat ? ` · ${cat}` : ''}${eng ? `（${eng}解析）` : ''}`);
      onSaved();
      onClose();
    } catch (e) {
      toast(`无法识别金额：「${useText.slice(0, 20)}」请试试「XX元 干什么」`, 'err');
      setSaving(false);
    }
  };

  const canListen = state.supported && !state.listening;
  const canConfirm = !saving && text.trim().length > 0;

  return (
    <Modal title="" onClose={onClose} wide>
      {/* 实时转录（只读）：紧凑高度，识别中才有大块空间，否则小提示即可 */}
      <div className="panel-inset" style={{ padding: '10px 14px', minHeight: 56 }}>
        <div className="eyebrow eyebrow--black" style={{ marginBottom: 4, fontSize: 10 }}>TRANSCRIPT / 转录</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', minHeight: 18, lineHeight: 1.4 }}>
          {interimText || <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, fontSize: 13 }}>{state.listening ? '聆听中…' : '等待语音或手动输入…'}</span>}
          {state.listening && <span style={{ display: 'inline-block', width: 6, height: 14, background: 'var(--eva-red)', marginLeft: 3, verticalAlign: 'text-bottom', animation: 'cursor-blink 1s step-end infinite' }} />}
        </div>
      </div>

      {/* 可编辑文本框：识别结果自动填入，也可手动输入 — 紧凑 2 行起步 */}
      <textarea
        className="input"
        rows={2}
        placeholder="手动输入「昨天星巴克38块」"
        value={text}
        onChange={(e) => setText(e.target.value)}
        style={{
          width: '100%', marginTop: 12, fontSize: 14, lineHeight: 1.4,
          resize: 'vertical', minHeight: 48, maxHeight: 100, fontFamily: 'inherit',
        }}
      />

      {state.error && (
        <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 'var(--radius-md)', background: 'rgba(220,38,38,0.08)', color: 'var(--danger)', fontSize: 12, fontWeight: 500, lineHeight: 1.5 }}>
          ⚠ {state.error}
        </div>
      )}

      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button className="btn btn--ghost" onClick={onClose}>取消</button>
        <button
          className="btn btn--ghost"
          onClick={() => { setText(''); setFilled(false); void startVoice(); }}
          disabled={!canListen}
        >
          重新听
        </button>
        <button
          className="btn btn--primary"
          onClick={() => void parseAndSave(text)}
          disabled={!canConfirm}
        >
          {saving ? '记账中…' : '确认记账'}
        </button>
      </div>

      <style>{`
        @keyframes cursor-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </Modal>
  );
}
