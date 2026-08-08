// Asuka记账 标志 — 直接展示 Android App 图标（明日香头像）
// 桌面/移动端 logo、登录按钮等场景统一使用此视觉
// 图标本身已是成品（含安全区与阴影），容器不再额外加白底/描边

export default function Swoosh({ size = 40 }: { size?: number }) {
  return (
    <img
      src="/img/app_icon.png"
      alt="Asuka记账"
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        display: 'block',
        flexShrink: 0,
        userSelect: 'none',
        pointerEvents: 'none',
      }}
    />
  );
}
