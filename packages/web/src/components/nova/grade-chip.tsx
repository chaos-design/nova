import { cn } from "cn";
import type { NovaGrade } from "@/lib/nova";
import {
  GRADE_META,
  GRADE_THRESHOLDS,
  gradeMeta,
  scoreGapToNextGrade,
} from "@/lib/nova";

/** NOVA 评级徽章，带下一档升级提示 */
export function GradeChip({
  grade,
  score,
  showHint = false,
  className,
}: {
  grade: NovaGrade;
  /** 提供分数时额外渲染"距下一档还差 N 分" */
  score?: number;
  showHint?: boolean;
  className?: string;
}) {
  const meta = GRADE_META[grade];
  const next = showHint && score !== undefined ? nextThreshold(score) : null;

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs",
          meta.chipClass,
        )}
      >
        <span className="font-semibold">{grade}</span>
        <span className="nova-mono-label text-[0.5625rem] opacity-80">
          {gradeMeta(grade).label.split(" · ")[1]}
        </span>
      </span>
      {next && (
        <span className="nova-mono-label text-muted-foreground">{next}</span>
      )}
    </span>
  );
}

/** 距下一档评级的提示文案 */
function nextThreshold(score: number): string | null {
  const gap = scoreGapToNextGrade(score);
  // 阈值表升序，第一个高于当前分数的就是下一档；gap 为 0 时它必不存在
  const next = GRADE_THRESHOLDS.find((item) => item.min > score);
  if (gap === 0 || !next) return "已达最高评级";
  return `距 ${next.grade} 还差 ${gap.toFixed(1)}`;
}
