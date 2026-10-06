/**
 * 深空背景：星云辉光 + 极坐标网格 + 顶部扫描线。
 *
 * 纯装饰层，`aria-hidden` 且 `pointer-events-none`，不参与任何交互与无障碍树。
 */
export function CosmicBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="nova-backdrop absolute inset-0" />
      <div className="nova-grid absolute inset-0" />

      {/* 两颗缓慢漂移的"新星"，只为让深空不至于死板 */}
      <div className="animate-nova-drift absolute -top-32 left-[8%] size-[38rem] rounded-full bg-nova-accent/8 blur-[130px]" />
      <div className="animate-nova-drift absolute top-1/3 -right-40 size-[34rem] rounded-full bg-nova-accent-2/10 blur-[140px] [animation-delay:-8s]" />

      <div className="animate-nova-scan absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-nova-accent/6 to-transparent" />

      {/* 底部渐隐，保证长页面的文字始终压在暗底上 */}
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}
