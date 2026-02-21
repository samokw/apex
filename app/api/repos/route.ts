import { NextResponse } from "next/server";
import { getApexSession } from "@/lib/session";
import { listUserRepos } from "@/lib/github";

export async function GET() {
  const session = await getApexSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const repos = await listUserRepos(session.accessToken);
    return NextResponse.json({ repos });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to list repos";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
