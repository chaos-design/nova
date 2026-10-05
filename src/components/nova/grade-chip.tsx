import { cn } from "cn";
import { GRADE_META, gradeMeta } from "@/lib/nova";
import type { NovaGrade } from "@/lib/nova/types";

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
  const thresholds = [
    { grade: "S", min: 92 },
    { grade: "A", min: 85 },
    { grade: "B", min: 72 },
  ] as const;

  const higher = thresholds.filter((item) => score < item.min);
  if (higher.length === 0) return "已达最高评级";
  const next = higher[higher.length - 1];
  const gap = (next.min - score).toFixed(1);
  return `距 ${next.grade} 还差 ${gap}`;
}
