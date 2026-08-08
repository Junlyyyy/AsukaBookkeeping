// 语音识别工具 — 只保留联网大模型方式：千问语音识别大模型（阿里云百炼 Paraformer）
// 流程：AudioContext 16kHz 单声道 PCM 采集 → WAV → 直连千问转写（设置页配置的 Key，仅语音识别时联网）
//      无 Key 时回退本地后端 POST /api/v1/speech/transcribe（PC 模式）
// 注意：应用仅在语音识别时联网；其余（记账/解析/抓取）全部本地完成

import { transcribeQwenDirect, getDashScopeKey } from './qwenAsr';

export interface VoiceState {
  supported: boolean;
  mode: 'cloud-asr' | 'none';
  listening: boolean;
  interim: string;
  final: string;
  error: string | null;
}

type Handler = (s: VoiceState) => void;

let listeners = new Set<Handler>();
let interimBuf = '';
let finalBuf = '';
let listening = false;
let errorMsg: string | null = null;
let autoStopTimer: any = null;

// ---- 录音采集（AudioContext PCM）----
let audioCtx: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let scriptNode: ScriptProcessorNode | null = null;
let pcmChunks: Float32Array[] = [];

/** 当前引擎（只支持联网千问语音识别大模型） */
export let mode: 'cloud-asr' | 'none' = 'none';

function emit() {
  const state: VoiceState = {
    supported: mode !== 'none',
    mode,
    listening,
    interim: interimBuf,
    final: finalBuf,
    error: errorMsg,
  };
  listeners.forEach((h) => h(state));
}

/** 探测：千问语音识别是否可用 —— 优先本地配置的 Key（直连），其次后端（PC 模式） */
export async function detectMode(): Promise<'cloud-asr' | 'none'> {
  // 1) 设置页配置了 Key → 前端直连千问（APK/离线可用，仅语音识别联网）
  if (getDashScopeKey()) { mode = 'cloud-asr'; return mode; }
  // 2) 后端已配置（PC 模式）→ 走 /api/v1/speech/transcribe
  try {
    const { api } = await import('../api');
    const h = await api.speechHealth();
    if (h.ok) { mode = 'cloud-asr'; return mode; }
  } catch { /* fallthrough */ }
  mode = 'none';
  return mode;
}

export function isSupported(): boolean {
  return mode !== 'none';
}

/** 订阅状态变化，返回取消函数 */
export function onVoiceState(h: Handler): () => void {
  listeners.add(h);
  return () => listeners.delete(h);
}

// ===================== 录音采集（PCM → WAV → 云端识别） =====================

async function startRecording(): Promise<boolean> {
  try {
    const w = window as any;
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AC = w.AudioContext || w.webkitAudioContext;
    audioCtx = new AC({ sampleRate: 16000 });
    const ctx = audioCtx!;
    sourceNode = ctx.createMediaStreamSource(mediaStream);
    scriptNode = ctx.createScriptProcessor(4096, 1, 1);
    pcmChunks = [];
    scriptNode.onaudioprocess = (e: AudioProcessingEvent) => {
      const data = e.inputBuffer.getChannelData(0);
      pcmChunks.push(new Float32Array(data)); // 拷贝，避免复用
    };
    sourceNode.connect(scriptNode);
    scriptNode.connect(ctx.destination);
    return true;
  } catch {
    errorMsg = '无法访问麦克风：请在系统设置中允许麦克风权限';
    emit();
    return false;
  }
}

function stopRecording(): void {
  try { scriptNode?.disconnect(); } catch { /* ignore */ }
  try { sourceNode?.disconnect(); } catch { /* ignore */ }
  try { mediaStream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
  try { audioCtx?.close(); } catch { /* ignore */ }
  scriptNode = null; sourceNode = null; mediaStream = null; audioCtx = null;
}

function encodeWav(samples: Float32Array, sr: number): Blob {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const wstr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  wstr(8, 'WAVE');
  wstr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);            // PCM
  v.setUint16(22, 1, true);            // mono
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);       // byte rate
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  wstr(36, 'data');
  v.setUint32(40, n * 2, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

async function transcribeCloud(): Promise<void> {
  stopRecording();
  listening = false;
  emit(); // 先停动画
  const total = pcmChunks.reduce((s, a) => s + a.length, 0);
  if (total < 1600) { // 少于 0.1s，视为没有语音
    errorMsg = '未检测到语音，请靠近麦克风重试';
    emit();
    return;
  }
  const samples = new Float32Array(total);
  let idx = 0;
  for (const a of pcmChunks) { samples.set(a, idx); idx += a.length; }
  pcmChunks = [];
  try {
    const blob = encodeWav(samples, 16000);
    const key = getDashScopeKey();
    if (key) {
      // 直连千问（设置页配置的 Key；仅此一步联网）
      try {
        const text = await transcribeQwenDirect(blob, key);
        if (!text) { errorMsg = '千问大模型未识别到语音内容，请重试'; }
        else { finalBuf = text; errorMsg = null; }
        emit();
        return;
      } catch (e) {
        console.warn('[voice] 直连千问失败，尝试后端:', (e as Error).message);
      }
    }
    // 回退后端（PC 模式 /api/v1/speech/transcribe）
    const { api } = await import('../api');
    const r = await api.speechTranscribe(blob);
    if (!r.text) {
      errorMsg = '千问大模型未识别到语音内容，请重试';
    } else {
      finalBuf = r.text;
      errorMsg = null;
    }
  } catch (e) {
    errorMsg = `语音识别失败：${(e as Error).message}`;
  }
  emit();
}

// ===================== 对外接口 =====================

/** 启动语音识别（录音后上传千问大模型识别；最长 15s 自动结束） */
export async function startVoice(): Promise<boolean> {
  if (listening) return true;
  if (mode !== 'cloud-asr') {
    errorMsg = '语音识别未启用：需要后端配置千问语音识别（DASHSCOPE_API_KEY）';
    emit();
    return false;
  }
  interimBuf = '';
  finalBuf = '';
  errorMsg = null;
  const ok = await startRecording();
  if (!ok) return false;
  listening = true;
  emit();
  autoStopTimer = setTimeout(() => { void transcribeCloud(); }, 15000);
  return true;
}

/** 停止识别并返回文本（自动上传千问大模型转写） */
export async function stopVoice(): Promise<string> {
  if (autoStopTimer) { clearTimeout(autoStopTimer); autoStopTimer = null; }
  if (listening) await transcribeCloud();
  return finalBuf.trim();
}

/** 清理监听（组件卸载时调用） */
export function clearVoice() {
  listeners.clear();
  stopRecording();
}
