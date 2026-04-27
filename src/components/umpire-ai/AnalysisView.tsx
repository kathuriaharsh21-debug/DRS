'use client'

import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Video, Map, BarChart3 } from "lucide-react";
import type { AnalysisResult } from "@/lib/types";
import VideoPlayer from "./VideoPlayer";
import DecisionPanel from "./DecisionPanel";
import PitchMap from "./PitchMap";
import StatsPanel from "./StatsPanel";

interface AnalysisViewProps {
  videoUrl: string;
  analysisResult: AnalysisResult;
  onReset: () => void;
}

export default function AnalysisView({
  videoUrl,
  analysisResult,
  onReset,
}: AnalysisViewProps) {
  return (
    <div className="w-full max-w-6xl mx-auto animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — Video player + tabs */}
        <div className="lg:col-span-2 space-y-6">
          {/* Video Player */}
          <VideoPlayer videoUrl={videoUrl} analysisResult={analysisResult} />

          {/* Analysis Tabs */}
          <Tabs defaultValue="pitchmap" className="w-full">
            <TabsList className="w-full bg-muted/50 border border-border/30">
              <TabsTrigger
                value="pitchmap"
                className="flex-1 data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-400"
              >
                <Map className="w-4 h-4 mr-2" />
                Pitch Map
              </TabsTrigger>
              <TabsTrigger
                value="stats"
                className="flex-1 data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-400"
              >
                <BarChart3 className="w-4 h-4 mr-2" />
                Stats
              </TabsTrigger>
            </TabsList>
            <TabsContent value="pitchmap" className="mt-4">
              <Card className="border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
                    <Video className="w-4 h-4" />
                    Top-Down Pitch View
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <PitchMap analysisResult={analysisResult} />
                  <p className="text-xs text-muted-foreground/60 mt-3 text-center">
                    Showing ball trajectory mapped onto pitch coordinates
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="stats" className="mt-4">
              <StatsPanel result={analysisResult} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Right column — Decision Panel */}
        <div className="space-y-4">
          <DecisionPanel result={analysisResult} />
        </div>
      </div>

      {/* Analyze another button */}
      <div className="text-center mt-8">
        <button
          onClick={onReset}
          className="px-6 py-2.5 rounded-lg bg-muted/50 border border-border/30 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted hover:border-border transition-all duration-200"
        >
          Analyze Another Delivery
        </button>
      </div>
    </div>
  );
}
