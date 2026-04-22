/**
 * 실시간 STT+번역 Provider 추상화.
 *
 * session-handler.ts 가 브라우저 WS + auth + trial + heartbeat + persist 를 담당하고,
 * Provider 는 오직 "오디오 입력 → 원문/번역 최종 결과 출력" 만 책임진다.
 *
 * 현재 구현체:
 *   - OpenAIRealtimeProvider: OpenAI Realtime API (STT + 번역 통합 WS)
 *   - GoogleProvider: Google Cloud Speech-to-Text streaming + Cloud Translation
 *
 * 향후: Azure Speech, Deepgram 등.
 */

import type { Logger as PinoLogger } from "pino";

export interface ProviderEmitter {
  /** 사용자 발화 원문이 확정된 시점. */
  onSourceFinal: (text: string, confidenceScore: number | null) => void;
  /** 번역이 확정된 시점 (원문과 1:1). */
  onTranslationFinal: (text: string) => void;
  /** Assist 모드 응답 (1회성 텍스트). */
  onAssistText: (text: string) => void;
  /** 클라이언트에게 바로 포워딩할 generic 이벤트. */
  emitRaw: (event: Record<string, unknown>) => void;
  /** 복구 불가 오류 — 상위가 클라이언트 연결을 끊는다. */
  onError: (code: string, message: string) => void;
}

export interface ProviderStartOptions {
  sessionId: string;
  sourceLang: string;
  targetLang: string;
  log: PinoLogger;
  emit: ProviderEmitter;
}

export interface ProviderHandle {
  /** PCM16 16k mono 청크 송신. */
  sendAudio(chunk: Buffer): void;
  /** 사용자 턴 종료 힌트 (일부 provider 는 no-op). */
  commit(): void;
  /** 진행 중인 번역/응답 취소 (일부 provider 는 no-op). */
  interrupt(): void;
  /** Assist 텍스트 생성 요청. 완료 시 emit.onAssistText 콜백. */
  assist(intent: string, priorText?: string): Promise<void>;
  /**
   * 원문 → 대상 언어 번역. 세션 핸들러가 최종 원문 확정 시점에 직접 호출.
   * - Google: Cloud Translation v2 HTTP.
   * - OpenAI Realtime: no-op (OpenAI 가 스트림 내에서 자체 번역을 이미 흘려보냄).
   */
  translate(text: string): Promise<string>;
  /** 세션 종료. 업스트림 스트림/커넥션 정리. */
  close(): Promise<void>;
}

export interface RealtimeProvider {
  readonly name: "openai" | "google";
  start(opts: ProviderStartOptions): Promise<ProviderHandle>;
}
