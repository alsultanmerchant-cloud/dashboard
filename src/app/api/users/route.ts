import { NextResponse } from "next/server";

// Phase 2 stub — the legacy `/api/users` referenced a `user_profiles` table
// that doesn't exist in the new schema. Phase 7 rebuilds employee management
// on top of `employee_profiles` + `user_roles`.

export async function GET() {
  return NextResponse.json([], { status: 200 });
}

export async function POST() {
  return NextResponse.json(
    { error: "User management is being rebuilt. See Phase 7 plan." },
    { status: 503 },
  );
}
