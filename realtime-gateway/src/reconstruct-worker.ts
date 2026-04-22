/**
 * 사후 복원 워커 (A-3).
 *
 * 책임:
 *   1) `reconstructions.status='pending'` 행을 10초 간격으로 한 건씩 집어온다.
 *   2) "pending → running" 조건부 UPDATE 로 race-safe claim.
 *   3) reconstruct.ts#runReconstruction 호출.
 *   4) 성공 시 status='done' + 4개 필드 채움 + completed_at.
 *   5) 실패 시 status='failed' + error_message + retry_count 증가.
 *
 * 파서 워커보다 주기가 길다 (10초): LLM 호출이 수 초 소요, 빈번한 폴링 실익 없음.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import type { Logger as PinoLogger } from "pino";
import { ENV } from "./env.js";
import { logger } from "./logger.js";
import type { Database, Json } from "./db-types.js";
import { runReconstruction, callOpenAIChat } from "./reconstruct.js";

type ReconRow = Database["public"]["Tables"]["reconstructions"]["Row"];

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

export interface ReconstructWorkerHandle {
  stop: () => void;
}

export function startReconstructWorker(): ReconstructWorkerHandle {
  const interval = ENV.RECONSTRUCT_POLL_INTERVAL_MS;
  const log = logger.child({ worker: "reconstruct" });
  log.info({ interval }, "reconstruct_worker_started");

  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void tick(log).finally(() => {
      running = false;
    });
  }, interval);

  return {
    stop: () => {
      clearInterval(timer);
      log.info("reconstruct_worker_stopped");
    },
  };
}

async function tick(log: PinoLogger): Promise<void> {
  const { data: candidates, error: selErr } = await sb()
    .from("reconstructions")
    .select("id")
    .eq("status", "pending")
    .order("requested_at", { ascending: true })
    .limit(1);
  if (selErr) {
    log.warn({ err: String(selErr) }, "reconstruct_select_failed");
    return;
  }
  if (!candidates || candidates.length === 0) return;
  const id = candidates[0]!.id;

  const { data: claimed, error: claimErr } = await sb()
    .from("reconstructions")
    .update({ status: "running" })
    .eq("id", id)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (claimErr) {
    log.warn({ err: String(claimErr), id }, "reconstruct_claim_failed");
    return;
  }
  if (!claimed) return;
  await processOne(claimed as ReconRow, log);
}

async function processOne(row: ReconRow, log: PinoLogger): Promise<void> {
  const outcome = await runReconstruction(row.session_id, {
    sb: sb(),
    callOpenAI: callOpenAIChat,
    log,
  });

  if (outcome.kind === "ok") {
    const { error: upErr } = await sb()
      .from("reconstructions")
      .update({
        status: "done",
        summary: outcome.result.summary,
        key_decisions: outcome.result.key_decisions as unknown as Json,
        action_items: outcome.result.action_items as unknown as Json,
        important_numbers: outcome.result.important_numbers as unknown as Json,
        completed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", row.id);
    if (upErr) {
      log.error(
        { id: row.id, err: String(upErr) },
        "reconstruct_write_done_failed",
      );
    } else {
      log.info(
        {
          id: row.id,
          session: row.session_id,
          model: outcome.model,
          summary_len: outcome.result.summary.length,
          decisions: outcome.result.key_decisions.length,
          actions: outcome.result.action_items.length,
          numbers: outcome.result.important_numbers.length,
        },
        "reconstruct_ok",
      );
    }
    return;
  }

  // 실패.
  const errMsg = `[${outcome.code}] ${outcome.message}`.slice(0, 1000);
  log.error({ id: row.id, code: outcome.code }, "reconstruct_failed");
  const { error: upErr } = await sb()
    .from("reconstructions")
    .update({
      status: "failed",
      error_message: errMsg,
      retry_count: (row.retry_count ?? 0) + 1,
      completed_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (upErr) {
    log.warn(
      { id: row.id, err: String(upErr) },
      "reconstruct_mark_failed_also_failed",
    );
  }
}
