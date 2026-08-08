// NERV 徽标（新世纪福音战士·秘密组织标志）
// 复刻官方 logo：上半六边形（橙红渐变）+ 下半三角形（鲜红）+ NERV 字样
// 用法：作为 EVA 主题标志性元素嵌入页脚、About 卡、卡片角标

export default function NERVBadge({ size = 56 }: { size?: number }) {
  const id = 'nerv-grad-' + size;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-label="NERV"
      role="img"
      style={{ display: 'inline-block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1a1a1a" />
          <stop offset="100%" stopColor="#0a0a0a" />
        </linearGradient>
        <linearGradient id={id + '-red'} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ec2323" />
          <stop offset="100%" stopColor="#b8230d" />
        </linearGradient>
      </defs>
      {/* 上半六边形（深色背景 + 橙色边框） */}
      <polygon
        points="50,5 92,30 92,55 50,80 8,55 8,30"
        fill={`url(#${id})`}
        stroke="#e6770b"
        strokeWidth="2.5"
      />
      {/* 下半左侧三角（鲜红） */}
      <polygon
        points="50,80 8,55 50,95"
        fill={`url(#${id}-red)`}
      />
      {/* 下半右侧三角（鲜红） */}
      <polygon
        points="50,80 92,55 50,95"
        fill={`url(#${id}-red)`}
      />
      {/* NERV 字样（橙红高亮） */}
      <text
        x="50" y="50"
        textAnchor="middle"
        fill="#e6770b"
        fontWeight="900"
        fontSize="18"
        fontFamily="var(--font-display), monospace"
        letterSpacing="0.05em"
      >
        NERV
      </text>
      {/* 底部装饰线 */}
      <line x1="28" y1="62" x2="72" y2="62" stroke="#e6770b" strokeWidth="1.2" />
    </svg>
  );
}