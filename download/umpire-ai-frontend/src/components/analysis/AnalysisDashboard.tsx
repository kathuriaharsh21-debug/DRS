import { useState } from 'react';
import { Map, BarChart3 } from 'lucide-react';
import { FrameByFramePlayer } from '../video/FrameByFramePlayer';
import { DecisionPanel } from './DecisionPanel';
import { PitchMap } from './PitchMap';
import { StatsPanel } from './StatsPanel';
import type { AnalysisResultResponse } from '../../types';

interface AnalysisDashboardProps {
  result: AnalysisResultResponse;
  videoUrl: string;
}

type TabId = 'pitch-map' | 'stats';

export function AnalysisDashboard({ result, videoUrl }: AnalysisDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabId>('pitch-map');

  const tabs: { id: TabId; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'pitch-map', label: 'Pitch Map', icon: Map },
    { id: 'stats', label: 'Statistics', icon: BarChart3 },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Video + Tabs (2/3) */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Video Player */}
          <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
            <FrameByFramePlayer
              videoSrc={videoUrl}
              frames={result.frames}
              trajectoryPoints={result.trajectory.points}
              fps={30}
            />
          </div>

          {/* Tabs */}
          <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
            {/* Tab Headers */}
            <div className="flex border-b border-slate-800">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative ${
                    activeTab === tab.id
                      ? 'text-emerald-400'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                  {activeTab === tab.id && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-400" />
                  )}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="p-4">
              {activeTab === 'pitch-map' && (
                <PitchMap trajectory={result.trajectory} />
              )}
              {activeTab === 'stats' && (
                <StatsPanel result={result} />
              )}
            </div>
          </div>
        </div>

        {/* Right: Decision Panel (1/3) */}
        <div className="lg:col-span-1">
          <div className="sticky top-20">
            <DecisionPanel result={result} />
          </div>
        </div>
      </div>
    </div>
  );
}
