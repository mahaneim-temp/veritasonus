/**
 * Realtime 공급자 추상화.
 * 기본은 OpenAI Realtime. Azure Speech / Google STT+Translate 등으로 교체 가능.
 *
 * ⚠ 이 인터페이스는 realtime-gateway 프로세스에서 구현/호출한다.
 *   브라우저는 게이트웨이와만 WS로 통신하므로 이 파일을 직접 import 하지 않는다.
 */

import type {
  QualityMode,
  SessionMode,
  ConfidenceLevel,
} from "@/types/session";

export interface RealtimeAdapterOptions {
  sessionId: string;
  mode: SessionMode;
  qualityMode: QualityMode;
  sourceLang: string;
  targetLang: string;
  /** 업로드 자료 바이어싱이 반영된 instructions 전체 */
  instructions: string;
  /** glossary 의 key→value 매핑 (tool call로 넘김) */
  glossary?: Record<string, string>;
}

export interface RealtimeSession {
  /** 오디오 PCM(Int16) 20~40ms 청크 입력 */
  writeAudio(chunk: ArrayBuffer): void | Promise<void>;
  /** STT 파셜 콜백 */
  onSpeechPartial(cb: (seq: number, text: string) => void): void;
  onSpeechFinal(
    cb: (seq: number, text: string, score: number) => void,
  ): void;
  onTranslationFinal(
    cb: (
      seq: number,
      text: string,
      level: ConfidenceLevel,
      score: number,
      flags: string[],
    ) => void,
  ): void;
  onError(cb: (code: string, message: string) => void): void;
  /** 세션 종료 */
  close(): Promise<void>;
}

export interface RealtimeAdapter {
  open(options: RealtimeAdapterOptions): Promise<RealtimeSession>;
}
