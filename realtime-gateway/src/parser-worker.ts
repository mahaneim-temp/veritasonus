/**
 * 자료 파싱 워커 (A-2).
 *
 * 책임:
 *   1) `session_assets.parse_status='pending'` 행을 5초 간격으로 한 건씩 집어온다.
 *   2) Storage 에서 파일을 내려받아 `parser.ts#extractText` 로 본문 추출.
 *   3) 결과를 `extracted_text` (최대 100KB) 에 저장 + `parse_status='done'` + `parsed_at=now()`.
 *   4) 실패 시 `parse_status='failed'` + `parse_error` 에 사유 기록.
 *
 * 다중 인스턴스 안전:
 *   - claim() 은 "UPDATE ... WHERE parse_status='pending'" 에 id 를 고정해 조건부 update 로 수행.
 *     영향 받은 row 수 확인 후 0 이면 다른 인스턴스가 가져간 것으로 보고 넘어감.
 *   - Fly.io 단일 머신(min=1) 이 기본 전제지만, 스케일아웃 대비 안전 로직 포함.
 *
 * 생명주기:
 *   - `startParserWorker()` 가 setInterval 핸들을 반환. `stopParserWorker(handle)` 로 종료.
 *   - server.ts 에서 부팅 시 호출.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import type { Logger as PinoLogger } from "pino";
import { ENV } from "./env.js";
import { logger } from "./logger.js";
import type { Database } from "./db-types.js";
import { extractText, ParseError } from "./parser.js";

type AssetRow = Database["public"]["Tables"]["session_assets"]["Row"];

let _sb: SupabaseClient<Database> | null = null;
function sb(): SupabaseClient<Database> {
  if (_sb) return _sb;
  _sb = createClient<Database>(
    ENV.SUPABASE_URL,
    ENV.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return _sb;
}

export interface ParserWorkerHandle {
  stop: () => void;
}

export function startParserWorker(): ParserWorkerHandle {
  const interval = ENV.PARSER_POLL_INTERVAL_MS;
  const log = logger.child({ worker: "parser" });
  log.info({ interval }, "parser_worker_started");

  let running = false;
  const timer = setInterval(() => {
    if (running) return; // 한 틱이 오래 걸리면 겹쳐서 뛰지 않게 skip.
    running = true;
    void tick(log).finally(() => {
      running = false;
    });
  }, interval);

  return {
    stop: () => {
      clearInterval(timer);
      log.info("parser_worker_stopped");
    },
  };
}

async function tick(log: PinoLogger): Promise<void> {
  // 1. 가장 오래된 pending 1건 조회.
  const { data: candidates, error: selErr } = await sb()
    .from("session_assets")
    .select("id")
    .eq("parse_status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);
  if (selErr) {
    log.warn({ err: String(selErr) }, "parser_select_failed");
    return;
  }
  if (!candidates || candidates.length === 0) return;
  const id = candidates[0]!.id;

  // 2. 조건부 claim (pending → running). 경쟁 시 0 row 반환.
  const { data: claimed, error: claimErr } = await sb()
    .from("session_assets")
    .update({ parse_status: "running" })
    .eq("id", id)
    .eq("parse_status", "pending")
    .select("*")
    .maybeSingle();
  if (claimErr) {
    log.warn({ err: String(claimErr), id }, "parser_claim_failed");
    return;
  }
  if (!claimed) {
    // 다른 인스턴스가 먼저 가져감.
    return;
  }
  const row = claimed as AssetRow;
  await processOne(row, log);
}

async function processOne(
  row: AssetRow,
  log: PinoLogger,
): Promise<void> {
  const id = row.id;
  try {
    if (!row.file_path) {
      throw new ParseError("corrupt_file", "file_path 누락");
    }

    // 3. Storage 다운로드.
    const dl = await sb()
      .storage.from(ENV.PARSER_STORAGE_BUCKET)
      .download(row.file_path);
    if (dl.error || !dl.data) {
      throw new ParseError(
        "corrupt_file",
        `storage download 실패: ${String(dl.error)}`,
      );
    }
    const arrayBuf = await dl.data.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);

    // 4. 파싱.
    const ext =
      row.file_name?.split(".").pop() ??
      row.file_path.split(".").pop() ??
      null;
    const text = await extractText(buffer, {
      mime: row.mime_type ?? null,
      extension: ext,
    });

    // 5. 성공 반영.
    const { error: upErr } = await sb()
      .from("session_assets")
      .update({
        extracted_text: text,
        parse_status: "done",
        parse_error: null,
        parsed_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (upErr) throw upErr;
    log.info(
      { id, chars: text.length, session: row.session_id },
      "parser_ok",
    );
  } catch (e) {
    const code =
      e instanceof ParseError ? e.code : "internal";
    const message = e instanceof Error ? e.message : String(e);
    log.error({ id, code, err: message }, "parser_failed");
    const { error: upErr } = await sb()
      .from("session_assets")
      .update({
        parse_status: "failed",
        parse_error: `[${code}] ${message}`.slice(0, 1000),
        parsed_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (upErr) {
      log.warn(
        { id, err: String(upErr) },
        "parser_failed_mark_failed_also_failed",
      );
    }
  }
}
