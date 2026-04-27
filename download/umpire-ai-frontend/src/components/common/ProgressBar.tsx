interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
  showPercent?: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'emerald' | 'amber' | 'red';
  className?: string;
}

const sizeClasses = {
  sm: 'h-1',
  md: 'h-2',
  lg: 'h-3',
} as const;

const variantClasses = {
  default: 'bg-slate-600',
  emerald: 'bg-emerald-400',
  amber: 'bg-amber-400',
  red: 'bg-red-400',
} as const;

export function ProgressBar({
  value,
  max = 100,
  label,
  showPercent = false,
  size = 'md',
  variant = 'emerald',
  className = '',
}: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div className={className}>
      {(label || showPercent) && (
        <div className="mb-1 flex items-center justify-between">
          {label && <span className="text-xs font-medium text-slate-400">{label}</span>}
          {showPercent && <span className="text-xs font-mono text-slate-500">{Math.round(pct)}%</span>}
        </div>
      )}
      <div className={`w-full overflow-hidden rounded-full bg-slate-800 ${sizeClasses[size]}`}>
        <div
          className={`${sizeClasses[size]} rounded-full transition-all duration-500 ease-out ${variantClasses[variant]}`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}
