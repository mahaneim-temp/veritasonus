/**
 * POST /api/sessions/[id]/assets
 *
 * multipart/form-data:
 *   - file: 업로드 원본 (≤ 10MB free / 50MB pro)
 *   - asset_type: script | slides | glossary | sermon_note | speaker_profile
 *
 * 처리:
 *   1) 권한 확인.
 *   2) Supabase Storage 'uploads' 버킷에 PUT.
 *   3) session_assets row insert (parse_status='pending').
 *   4) 응답: { asset_id, parse_status }.
 *
 * 파싱은 별도 워커가 처리 (Postgres NOTIFY → realtime-gateway 또는 Edge Cron).
 *
 * GET /api/sessions/[id]/assets — 업로드 목록 조회.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { v4 as uuidv4 } from "uuid";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { logger } from "@/lib/utils/logger";
import type { UploadAssetResponse, AssetType } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED: AssetType[] = [
  "script",
  "slides",
  "glossary",
  "sermon_note",
  "speaker_profile",
];

const SIZE_FREE = 10 * 1024 * 1024;
const SIZE_PAID = 50 * 1024 * 1024;

async function authorizeOwner(sessionId: string) {
  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  const guestId = cookies().get("lucid_guest_id")?.value;
  const { data: row } = await supabaseService()
    .from("sessions")
    .select("owner_type,owner_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (!row) return { ok: false as const, code: 404, isPaid: false };
  const r = row as any;
  const isOwner =
    (r.owner_type === "member" && user && r.owner_id === user.id) ||
    (r.owner_type === "guest" && guestId && r.owner_id === guestId);
  if (!isOwner) return { ok: false as const, code: 403, isPaid: false };

  let isPaid = false;
  if (user) {
    const { data: prof } = await sb
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    isPaid =
      !!prof && ["paid", "admin", "superadmin"].includes((prof as any).role);
  }
  return { ok: true as const, isPaid };
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await authorizeOwner(params.id);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "권한 없음" } },
      { status: auth.code },
    );
  }

  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "multipart/form-data 필요" } },
      { status: 400 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (e) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "form parse 실패" } },
      { status: 400 },
    );
  }
  const file = form.get("file");
  const asset_type = String(form.get("asset_type") ?? "");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "file 누락" } },
      { status: 400 },
    );
  }
  if (!ALLOWED.includes(asset_type as AssetType)) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "asset_type 부적절" } },
      { status: 400 },
    );
  }
  const sizeLimit = auth.isPaid ? SIZE_PAID : SIZE_FREE;
  if (file.size > sizeLimit) {
    return NextResponse.json(
      {
        error: {
          code: "too_large",
          message: `파일 크기 한도 초과 (${Math.floor(sizeLimit / 1024 / 1024)}MB)`,
        },
      },
      { status: 413 },
    );
  }

  const id = uuidv4();
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
  const path = `sessions/${params.id}/${id}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  try {
    const svc = supabaseService();
    const up = await svc.storage
      .from("uploads")
      .upload(path, buf, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (up.error) throw up.error;

    const { error } = await svc.from("session_assets").insert({
      id,
      session_id: params.id,
      asset_type: asset_type as AssetType,
      file_name: file.name,
      mime_type: file.type || null,
      file_path: path,
      size_bytes: file.size,
      parse_status: "pending",
    });
    if (error) throw error;
  } catch (e) {
    logger.error("asset_upload_failed", { e: String(e) });
    return NextResponse.json(
      { error: { code: "internal", message: "업로드 실패" } },
      { status: 500 },
    );
  }

  const payload: UploadAssetResponse = { asset_id: id, parse_status: "pending" };
  return NextResponse.json(payload, { status: 201 });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await authorizeOwner(params.id);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "권한 없음" } },
      { status: auth.code },
    );
  }
  const { data, error } = await supabaseService()
    .from("session_assets")
    .select("id,asset_type,file_name,mime_type,size_bytes,parse_status,created_at")
    .eq("session_id", params.id)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json(
      { error: { code: "internal", message: "조회 실패" } },
      { status: 500 },
    );
  }
  return NextResponse.json({ items: data ?? [] });
}
