import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = "https://umpire-ai-backend.onrender.com";

// POST /api/process-video — Upload and start analysis
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "No video file provided. Use field name 'file'." },
        { status: 400 }
      );
    }

    // Build new FormData to send to backend
    const backendFormData = new FormData();
    backendFormData.append("file", file);
    backendFormData.append("ball_type", formData.get("ball_type") || "red");

    // Forward to Render backend with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300000); // 5 min

    try {
      const res = await fetch(`${BACKEND_URL}/api/upload-and-analyze`, {
        method: "POST",
        body: backendFormData,
        signal: controller.signal,
      });

      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error: any) {
    console.error("Proxy error:", error);
    if (error.name === "AbortError") {
      return NextResponse.json(
        { error: "Upload timed out. Backend may be starting up. Try again in 30s." },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: "Failed to connect to analysis backend. Please try again." },
      { status: 502 }
    );
  }
}

// GET /api/process-video?jobId=xxx&mode=status|result
export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  const mode = request.nextUrl.searchParams.get("mode") || "status";

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId parameter" }, { status: 400 });
  }

  const backendPath =
    mode === "result"
      ? `${BACKEND_URL}/api/analysis/${jobId}/result`
      : `${BACKEND_URL}/api/analysis/${jobId}/status`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const res = await fetch(backendPath, { signal: controller.signal });
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error: any) {
    console.error("Proxy error:", error);
    return NextResponse.json(
      { error: "Failed to connect to analysis backend." },
      { status: 502 }
    );
  }
}
