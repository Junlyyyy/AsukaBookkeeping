// 语音记账 Modal — 长按「说话」键录音，松开自动转写（千问）；识别结果可二次编辑，也可手动输入
import { useEffect, useRef, useState } from 'react';
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
    supported: false, mode: 'none', listening: false, transcribing: false, interim: '', final: '', error: null,
  });
  const [saving, setSaving] = useState(false);
  /** 识别结果 + 用户手动输入合并的最终文本（识别完成自动填入，可编辑） */
  const [text, setText] = useState('');
  /** 是否已从识别结果自动填充过，避免覆盖用户已编辑的内容 */
  const [filled, setFilled] = useState(false);
  /** 是否正在按住录音（防止重复触发） */
  const pressRef = useRef(false);
  /** 录音计时（秒） */
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    if (!state.listening) { setSecs(0); return; }
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state.listening]);

  useEffect(() => {
    const off = onVoiceState(setState);
    // 只探测模式，不自动录音 —— 由用户长按「说话」键触发
    void detectMode().then((m) => {
      if (m !== 'cloud-asr') {
        setState((s) => ({
          ...s,
          supported: false,
          mode: 'none',
          error: '语音识别未启用：请到「设置」页填入阿里云百炼 API Key（DASHSCOPE_API_KEY）—— 仅语音识别时联网，其余功能完全离线。',
        }));
      }
    });
    return () => { off(); clearVoice(); };
  }, []);

  // 长按手势：按下开始录音；无论手指在哪松开都停止并转写
  const startPress = () => {
    if (pressRef.current) return;
    pressRef.current = true;
    void startVoice();
  };
  const endPress = () => {
    if (!pressRef.current) return;
    pressRef.current = false;
    void stopVoice();
  };
  useEffect(() => {
    const up = () => endPress();
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 识别完成后一次性回填到编辑框（用户可继续修改）
  useEffect(() => {
    if (!state.listening && !state.transcribing && state.final && !filled) {
      setText(state.final.trim());
      setFilled(true);
    }
  }, [state.listening, state.transcribing, state.final, filled]);

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

  const canListen = state.supported && !state.listening && !state.transcribing;
  const canConfirm = !saving && text.trim().length > 0;

  return (
    <Modal title="" onClose={onClose} wide>
      {/* 实时转录（只读）：紧凑高度，识别中才有大块空间，否则小提示即可 */}
      <div className="panel-inset" style={{ padding: '10px 14px', minHeight: 56 }}>
        <div className="eyebrow eyebrow--black" style={{ marginBottom: 4, fontSize: 10 }}>TRANSCRIPT / 转录</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', minHeight: 18, lineHeight: 1.4 }}>
          {(state.final || state.interim) || <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, fontSize: 13 }}>
            {state.listening ? '聆听中…' : state.transcribing ? '识别中…' : '长按下方「说话」键录音，松开自动转写'}
          </span>}
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

      {/* 长按说话 — 精致浅色圆钮：玻璃质感，按住点亮红 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 18 }}>
        <button
          className={`voice-round${state.listening ? ' voice-round--live' : ''}`}
          disabled={!canListen}
          onPointerDown={startPress}
          onPointerUp={endPress}
          onPointerCancel={endPress}
          style={{ touchAction: 'none' }}
        >
          {state.transcribing ? (
            <span className="voice-round__spinner" />
          ) : (
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
            </svg>
          )}
        </button>
        <div className={`voice-round__label${state.listening ? ' voice-round__label--live' : ''}`}>
          {state.transcribing ? '识别中，请稍候…'
            : state.listening ? `松开结束 · ${String(secs).padStart(2, '0')}s`
            : canListen ? '长按说话 · 松开转写'
            : state.supported ? '处理中…'
            : '语音未启用'}
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        <button
          className="btn btn--ghost"
          onClick={() => { setText(''); setFilled(false); }}
          disabled={!text.trim()}
        >
          清空
        </button>
        <button className="btn btn--ghost" onClick={onClose}>取消</button>
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
        /* 精致浅色圆钮 */
        .voice-round {
          width: 78px; height: 78px; border-radius: 50%;
          border: 1px solid rgba(0,0,0,0.07);
          background: linear-gradient(180deg, rgba(255,255,255,0.95) 0%, #fdf1ec 100%);
          box-shadow: var(--shadow-xs), inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -3px 8px rgba(60,25,10,0.06);
          color: var(--eva-red);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: transform 0.12s var(--ease-apple), box-shadow 0.18s ease, background 0.18s ease, color 0.18s ease;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
        }
        .voice-round:hover:not(:disabled) {
          box-shadow: var(--shadow-sm), inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -3px 8px rgba(60,25,10,0.06);
        }
        .voice-round:active:not(:disabled) { transform: scale(0.96); }
        .voice-round--live {
          background: linear-gradient(135deg, var(--eva-red-bright), var(--eva-red));
          color: #fff;
          border-color: transparent;
          box-shadow: 0 0 0 7px rgba(211,41,15,0.12), 0 0 24px rgba(211,41,15,0.35), inset 0 2px 6px rgba(255,255,255,0.18);
        }
        .voice-round--live svg { animation: mic-thump 1s ease-in-out infinite; }
        .voice-round:disabled { cursor: not-allowed; filter: grayscale(0.8); opacity: 0.55; box-shadow: none; }
        .voice-round__spinner {
          width: 22px; height: 22px; border-radius: 50%;
          border: 2.5px solid rgba(211,41,15,0.2);
          border-top-color: var(--eva-red);
          animation: voice-spin 0.8s linear infinite;
        }
        .voice-round__label {
          margin-top: 10px;
          font-size: 12px; font-weight: 600; letter-spacing: 0.02em;
          color: var(--text-tertiary);
          font-variant-numeric: tabular-nums;
          min-height: 18px;
        }
        .voice-round__label--live { color: var(--eva-red); }
        @keyframes voice-spin { to { transform: rotate(360deg); } }
        @keyframes mic-thump {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.12); }
        }
      `}</style>
    </Modal>
  );
}
