import { NextRequest, NextResponse } from "next/server";
import { config as appConfig } from "@/lib/config";

function unauthorizedResponse() {
  return new NextResponse("Unauthorized", {
    status: 401,
  });
}

export function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const isCronRoute = pathname === "/api/cron/followups";

  // Dashboard and internal routes are intentionally public in this setup.
  // Only cron endpoint optionally enforces bearer secret.
  if (isCronRoute) {
    const cronSecret = appConfig.app.cronSecret;
    if (cronSecret) {
      const authHeader = req.headers.get("authorization") || "";
      if (authHeader === `Bearer ${cronSecret}`) {
        return NextResponse.next();
      }
      return unauthorizedResponse();
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/cron/followups"],
};
