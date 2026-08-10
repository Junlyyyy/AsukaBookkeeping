// 语音记账 Modal — 语音识别 / 手动输入 双通道完全独立，各自单独确认记账
// 通道A（语音）：长按圆钮录音 → 松开转写 → 识别结果进语音区 → 点「语音记账」独立入账
// 通道B（手动）：在手动区输入文本 → 点「手动记账」独立入账
// 两个通道互不干扰：识别结果只进语音区，绝不碰手动输入内容
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
  /** 语音识别结果（语音通道专用，可编辑修正错字） */
  const [voiceText, setVoiceText] = useState('');
  /** 手动输入内容（手动通道专用） */
  const [manualText, setManualText] = useState('');
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

  // 识别结果 → 写入语音通道（与手动通道完全隔离）
  useEffect(() => {
    if (!state.listening && !state.transcribing && state.final) {
      const finalText = state.final.trim();
      if (finalText) setVoiceText(finalText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.listening, state.transcribing, state.final]);

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
  const canConfirm = !saving && (voiceText.trim().length > 0 || manualText.trim().length > 0);

  // 合并确认记账：有语音记语音（语音是「记一笔」主入口），无语音记手动；两边都有优先语音并提示
  const onConfirm = () => {
    const v = voiceText.trim();
    const m = manualText.trim();
    if (v && m) {
      toast('语音和手动均有内容，已按语音记账');
      return void parseAndSave(v);
    }
    if (v) return void parseAndSave(v);
    if (m) return void parseAndSave(m);
    return toast('请先说话或输入内容', 'err');
  };

  return (
    <Modal title="" onClose={onClose} wide>
      {/* ============ 通道A：语音识别 ============ */}
      <div className="panel-inset">
        <div className="eyebrow eyebrow--black" style={{ fontSize: 10 }}>VOICE / 语音识别</div>

        {/* 识别结果（可编辑修正错字） */}
        <textarea
          className="input"
          rows={2}
          placeholder="识别结果将显示在这里，可修改错字"
          value={voiceText}
          onChange={(e) => setVoiceText(e.target.value)}
          style={{
            width: '100%', marginTop: 8, fontSize: 14, lineHeight: 1.4,
            resize: 'vertical', minHeight: 44, maxHeight: 90, fontFamily: 'inherit',
          }}
        />

        {state.error && (
          <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 'var(--radius-md)', background: 'rgba(220,38,38,0.08)', color: 'var(--danger)', fontSize: 12, fontWeight: 500, lineHeight: 1.5 }}>
            ⚠ {state.error}
          </div>
        )}

        {/* 长按说话 — 精致浅色圆钮 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 12 }}>
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
      </div>

      {/* ============ 通道B：手动输入 ============ */}
      <div className="panel-inset" style={{ marginTop: 14 }}>
        <div className="eyebrow eyebrow--black" style={{ fontSize: 10 }}>MANUAL / 手动输入</div>
        <textarea
          className="input"
          rows={2}
          placeholder="手动输入，如：昨天星巴克38块"
          value={manualText}
          onChange={(e) => setManualText(e.target.value)}
          style={{
            width: '100%', marginTop: 8, fontSize: 14, lineHeight: 1.4,
            resize: 'vertical', minHeight: 44, maxHeight: 90, fontFamily: 'inherit',
          }}
        />
      </div>

      {/* 底部：合并确认记账 + 取消 */}
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
        <button className="btn btn--ghost" onClick={onClose}>取消</button>
        <button
          className="btn btn--primary"
          onClick={onConfirm}
          disabled={!canConfirm}
        >
          {saving ? '记账中…' : '确认记账'}
        </button>
      </div>

      <style>{`
        /* 精致浅色圆钮 */
        .voice-round {
          width: 78px; height: 78px; border-radius: 50%;
          border: 1px solid rgba(60,25,10,0.10);
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
