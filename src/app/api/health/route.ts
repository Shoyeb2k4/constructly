import { NextResponse } from "next/server";

/**
 * Liveness/readiness probe. Cheap and dependency-free by default so uptime
 * checks stay fast; `?deep=1` additionally verifies the database connection.
 */
export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get("deep") === "1";
  const base = {
    status: "ok" as "ok" | "degraded",
    service: "constructly",
    time: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  };

  if (!deep) return NextResponse.json(base, { headers: { "Cache-Control": "no-store" } });

  try {
    const { prisma } = await import("@/lib/db/prisma");
    await prisma.$queryRaw`select 1`;
    return NextResponse.json({ ...base, database: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { ...base, status: "degraded", database: "unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
