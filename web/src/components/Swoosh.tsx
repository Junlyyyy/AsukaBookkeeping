// Asuka记账 标志 — 明日香应用图标（Kazumi 番剧 APP 图标标准形态：
// 纯白底（Android 自适应图标背景 #ffffff）+ 透明前景大头像抠图）
// 简洁：白底 → 大头像满幅（透明边缘即安全区）→ 细 EVA 红描边 + 柔和投影

export default function Swoosh({ size = 40 }: { size?: number }) {
  const radius = Math.round(size * 0.25);

  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: '#ffffff',
        boxShadow:
          '0 4px 14px rgba(140,20,8,0.16), 0 1px 3px rgba(0,0,0,0.08), inset 0 0 0 1.5px rgba(211,41,15,0.35)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
      }}
      aria-hidden="true"
    >
      {/* 大头像抠图：满幅填充（头像自身四周透明边缘 = 图标安全区，透出白底） */}
      <img
        src="/img/asuka_avatar_web.png"
        alt=""
        width={size}
        height={size}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    </span>
  );
}
