interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

const sizeMap = {
  sm: 'h-4 w-4 border-2',
  md: 'h-8 w-8 border-2',
  lg: 'h-12 w-12 border-3',
} as const;

export function LoadingSpinner({ size = 'md', className = '', label }: LoadingSpinnerProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 ${className}`} role="status">
      <div
        className={`${sizeMap[size]} animate-spin rounded-full border-slate-700 border-t-emerald-400`}
        aria-hidden="true"
      />
      {label && (
        <span className="text-sm text-slate-400">{label}</span>
      )}
      <span className="sr-only">Loading...</span>
    </div>
  );
}
