import { NextRequest, NextResponse } from "next/server";
import type { AnalysisResult, DecisionType, Decision } from "@/lib/types";

// ============================================================
// Umpire AI — Video Processing API
// Simulates computer vision analysis pipeline
// ============================================================

/** Decision scenarios for simulation */
const SCENARIOS: {
  decision: Decision;
  decisionType: DecisionType;
  weight: number;
}[] = [
  { decision: "OUT", decisionType: "LBW", weight: 35 },
  { decision: "OUT", decisionType: "BOWLED", weight: 15 },
  { decision: "OUT", decisionType: "CAUGHT_BEHIND", weight: 10 },
  { decision: "NOT OUT", decisionType: "NOT_OUT", weight: 20 },
  { decision: "NOT OUT", decisionType: "WIDE", weight: 10 },
  { decision: "NOT OUT", decisionType: "NO_BALL", weight: 10 },
];

/** Weighted random selection */
function weightedRandom(scenarios: typeof SCENARIOS) {
  const totalWeight = scenarios.reduce((sum, s) => sum + s.weight, 0);
  let random = Math.random() * totalWeight;
  for (const scenario of scenarios) {
    random -= scenario.weight;
    if (random <= 0) return scenario;
  }
  return scenarios[0];
}

/** Generate realistic frame data based on scenario */
function generateFrameData(
  decision: Decision,
  decisionType: DecisionType
): AnalysisResult["frameData"] {
  const points: AnalysisResult["frameData"] = [];
  const totalFrames = 30;

  // Ball release point (bowler's hand area)
  const startX = 0.15 + Math.random() * 0.1;
  const startY = 0.3 + Math.random() * 0.1;

  // Pitch point
  const pitchX = 0.4 + Math.random() * 0.2;
  const pitchY = 0.5 + Math.random() * 0.1;

  // Impact point (near batsman)
  const impactX = 0.75 + Math.random() * 0.05;
  const impactY = 0.55 + Math.random() * 0.1;

  // Post-impact (toward stumps or missing)
  const isHitting = decision === "OUT" && decisionType !== "CAUGHT_BEHIND";
  const postX = isHitting
    ? 0.78 + Math.random() * 0.04
    : 0.85 + Math.random() * 0.1;
  const postY = isHitting ? 0.52 + Math.random() * 0.06 : 0.4 + Math.random() * 0.3;

  for (let i = 0; i < totalFrames; i++) {
    const t = i / (totalFrames - 1);
    let x: number;
    let y: number;

    if (t < 0.4) {
      // Release to pitch
      const lt = t / 0.4;
      x = startX + (pitchX - startX) * lt;
      y = startY + (pitchY - startY) * lt - Math.sin(lt * Math.PI) * 0.15;
    } else if (t < 0.7) {
      // Pitch to impact
      const lt = (t - 0.4) / 0.3;
      const deviation = (Math.random() - 0.5) * 0.03;
      x = pitchX + (impactX - pitchX) * lt + deviation;
      y = pitchY + (impactY - pitchY) * lt - Math.sin(lt * Math.PI * 0.5) * 0.08;
    } else {
      // Impact to predicted path
      const lt = (t - 0.7) / 0.3;
      x = impactX + (postX - impactX) * lt;
      y = impactY + (postY - impactY) * lt;
    }

    points.push({
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      frame: i,
    });
  }

  return points;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("video");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No video file provided" },
        { status: 400 }
      );
    }

    // Validate file type
    const validTypes = [
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "video/x-msvideo",
    ];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Accepted: mp4, webm, mov, avi" },
        { status: 400 }
      );
    }

    // Validate file size (max 500MB)
    if (file.size > 500 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large. Maximum size: 500MB" },
        { status: 400 }
      );
    }

    // Simulate processing delay (3.5 seconds)
    await new Promise((resolve) => setTimeout(resolve, 3500));

    // Generate simulated analysis result
    const scenario = weightedRandom(SCENARIOS);
    const confidence = Math.floor(85 + Math.random() * 15);
    const ballSpeed = Math.floor(120 + Math.random() * 40);
    const deviation = Math.round((Math.random() * 4 - 1) * 10) / 10;
    const isHitting =
      scenario.decision === "OUT" && scenario.decisionType !== "CAUGHT_BEHIND";

    const pitchX = 0.4 + Math.random() * 0.2;
    const pitchY = 0.5 + Math.random() * 0.1;

    const result: AnalysisResult = {
      decision: scenario.decision,
      decisionType: scenario.decisionType,
      confidence,
      trajectory: {
        pitchPoint: {
          x: Math.round(pitchX * 100) / 100,
          y: Math.round(pitchY * 100) / 100,
        },
        deviation,
        impactHeight:
          Math.random() > 0.5
            ? "Middle"
            : Math.random() > 0.3
              ? "Low"
              : "High",
        predictedPath: isHitting ? "HITTING" : "MISSING",
        ballSpeed,
      },
      frameData: generateFrameData(scenario.decision, scenario.decisionType),
    };

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Processing error:", error);
    return NextResponse.json(
      { error: "Failed to process video" },
      { status: 500 }
    );
  }
}
