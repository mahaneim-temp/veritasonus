/**
 * OpenAI Realtime 이벤트 → DB 액션 라우팅 (순수 함수).
 *
 * 왜 분리했나:
 *   - openai-bridge.ts 의 handleUpstreamEvent 는 WebSocket·Supabase 같은 I/O 를 끼고 있어
 *     단위 테스트가 어려웠다.
 *   - 시퀀스 증가 / UPDATE vs INSERT 분기 / 엣지 케이스는 순수 로직이므로 분리해서
 *     `tests/transcript-routing.test.ts` 로 단위 검증.
 *
 * 원칙:
 *   - 이 파일은 fetch/console/Date.now() 등 부수효과를 절대 포함하지 않는다 (CLAUDE.md §3 #3 참고).
 *   - 호출 측은 반환된 `action` 을 보고 persist.ts 의 writeUtterance / updateUtteranceTranslation 을 호출한다.
 */

export interface TranscriptState {
  /** 세션 내에서 지금까지 저장된 utterance 의 마지막 seq. 0 이면 아직 없음. */
  utteranceSeq: number;
}

export type PersistAction =
  | {
      kind: "write_source";
      seq: number;
      text: string;
    }
  | {
      kind: "update_translation";
      seq: number;
      text: string;
    }
  | {
      kind: "noop";
      reason:
        | "empty_transcript"
        | "empty_translation"
        | "translation_before_source"
        | "unhandled_event";
    };

export interface RouteResult {
  nextState: TranscriptState;
  action: PersistAction;
}

/**
 * OpenAI Realtime 업스트림 이벤트 1건을 받아서:
 *   - 다음 상태(utteranceSeq 증가 여부)와
 *   - 호출 측이 수행해야 할 DB 액션 1건
 * 을 반환한다.
 *
 * 처리하는 이벤트:
 *   1) conversation.item.input_audio_transcription.completed — 사용자 원문 최종.
 *      → utteranceSeq+1 로 새 row insert (`write_source`).
 *   2) response.audio_transcript.done — 모델이 만든 번역 최종.
 *      → 가장 최근 utterance 의 translated_text UPDATE (`update_translation`).
 *      → utteranceSeq === 0 이면 번역이 원문보다 먼저 도착한 엣지 케이스이므로 `noop`.
 *
 * 가정:
 *   - transcription.completed 가 audio_transcript.done 보다 먼저 도착한다 (OpenAI 프로토콜 관찰).
 *     순서가 뒤바뀌는 케이스는 noop + 로깅으로 감지만 하고 손실을 감수한다.
 *     (옵션 B — 별도 테이블 방식 — 로 가면 이 순서 의존을 해소할 수 있다.)
 *   - partial 스트림(response.audio_transcript.delta) 은 UI forward 용으로만 쓰고 DB persist 하지 않는다.
 *     UPDATE 방식 특성상 마지막 final 값만 남겨도 충분.
 */
export function routeTranscriptEvent(
  state: TranscriptState,
  evt: { type?: string; [key: string]: unknown },
): RouteResult {
  switch (evt.type) {
    case "conversation.item.input_audio_transcription.completed": {
      const text = extractTranscript(evt);
      if (!text) {
        return {
          nextState: state,
          action: { kind: "noop", reason: "empty_transcript" },
        };
      }
      const nextSeq = state.utteranceSeq + 1;
      return {
        nextState: { utteranceSeq: nextSeq },
        action: { kind: "write_source", seq: nextSeq, text },
      };
    }
    case "response.audio_transcript.done": {
      const text = extractTranscript(evt);
      if (!text) {
        return {
          nextState: state,
          action: { kind: "noop", reason: "empty_translation" },
        };
      }
      if (state.utteranceSeq === 0) {
        return {
          nextState: state,
          action: { kind: "noop", reason: "translation_before_source" },
        };
      }
      return {
        nextState: state,
        action: {
          kind: "update_translation",
          seq: state.utteranceSeq,
          text,
        },
      };
    }
    default:
      return {
        nextState: state,
        action: { kind: "noop", reason: "unhandled_event" },
      };
  }
}

function extractTranscript(evt: { [key: string]: unknown }): string {
  const raw = evt["transcript"];
  return typeof raw === "string" ? raw.trim() : "";
}
