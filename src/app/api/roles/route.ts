import { NextResponse } from "next/server";

// Phase 2 stub — the legacy `/api/roles` table model used `allowed_pages` text[].
// New schema uses `roles` + `role_permissions` joined to `permissions`.
// Phase 7 reads/writes through new server actions, not REST.

export async function GET() {
  return NextResponse.json([], { status: 200 });
}

export async function POST() {
  return NextResponse.json(
    { error: "Role management is being rebuilt. See Phase 7 plan." },
    { status: 503 },
  );
}
