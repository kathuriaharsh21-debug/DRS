import { CircleDot, Home } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

export function Header() {
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <header className="sticky top-0 z-50 border-b border-slate-800/50 bg-slate-950/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo & Title */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-lg shadow-emerald-500/20 transition-transform group-hover:scale-105">
            <CircleDot className="h-5 w-5 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold leading-tight tracking-tight text-slate-50">
              Umpire AI
            </span>
            <span className="hidden text-xs leading-tight text-slate-500 sm:block">
              Cricket Trajectory Analysis
            </span>
          </div>
        </Link>

        {/* Navigation */}
        <nav className="flex items-center gap-2">
          {!isHome && (
            <Link
              to="/"
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            >
              <Home className="h-4 w-4" />
              <span className="hidden sm:inline">New Analysis</span>
            </Link>
          )}
          <div className="h-5 w-px bg-slate-800" />
          <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-400 border border-emerald-500/20">
            v2.0
          </span>
        </nav>
      </div>
    </header>
  );
}
