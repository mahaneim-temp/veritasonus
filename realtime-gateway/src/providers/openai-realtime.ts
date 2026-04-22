/**
 * OpenAIRealtimeProvider — 기존 openai-bridge.ts 의 업스트림 로직을 Provider 로 래핑.
 *
 * 특징:
 *   - WebSocket 하나로 STT + 번역 + assist 를 모두 처리.
 *   - 클라이언트의 "control.commit" 은 input_audio_buffer.commit + response.create 로 매핑.
 *   - 응답 이벤트(speech_final/translation_final)는 callback 으로 변환.
 */

import { WebSocket as WSClient } from "ws";
import type {
  ProviderHandle,
  ProviderStartOptions,
  RealtimeProvider,
} from "./types.js";
import { ENV } from "../env.js";

const ASSIST_SYSTEM_FOR_INTENT: Record<string, string> = {
  speak_self:
    "사용자가 직접 말하려 한다. 다음에 이어서 자연스럽게 말할 수 있는 한 문장을 한 줄만 제안해라.",
  listen_only:
    "사용자는 듣기만 하고 있다. 직전 발화의 핵심 의도와 행간(맥락/감정/뉘앙스)을 한 문장으로 짧게 요약해라.",
  assist:
    "통역 어시스트: 다음에 사용자가 말할 만한 적절한 표현 1개와, 직전 화자의 의도 한 줄을 제안해라. 형식: 'SAY: ...' 줄과 'INTENT: ...' 줄.",
};

class OpenAISession implements ProviderHandle {
  private upstream: WSClient | null = null;
  private closed = false;
  private lastSourceText = "";

  constructor(private readonly opts: ProviderStartOptions) {}

  async open(): Promise<void> {
    const ws = new WSClient(
      `${ENV.OPENAI_REALTIME_URL}?model=${encodeURIComponent(ENV.OPENAI_REALTIME_MODEL)}`,
      {
        headers: {
          Authorization: `Bearer ${ENV.OPENAI_API_KEY}`,
          "OpenAI-Beta": "realtime=v1",
        },
      },
    );
    this.upstream = ws;

    ws.on("open", () => {
      this.opts.log.info("openai_realtime_upstream_open");
      this.send({
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          input_audio_transcription: { model: "whisper-1" },
          turn_detection: { type: "server_vad" },
        },
      });
    });

    ws.on("message", (data) => {
      if (Buffer.isBuffer(data)) {
        // Raw audio — forward as-is for now (TTS playback is v1.1).
        return;
      }
      let evt: { type?: string; [k: string]: unknown };
      try {
        evt = JSON.parse(data.toString());
      } catch {
        return;
      }
      this.routeUpstreamEvent(evt);
    });

    ws.on("close", (code, reason) => {
      this.opts.log.info(
        { code, reason: reason.toString() },
        "openai_realtime_upstream_close",
      );
      if (!this.closed) this.opts.emit.onError("upstream_closed", String(code));
    });

    ws.on("error", (e) => {
      this.opts.log.error({ err: String(e) }, "openai_realtime_upstream_error");
      this.opts.emit.onError("upstream_error", String(e));
    });
  }

  private routeUpstreamEvent(evt: { type?: string; [k: string]: unknown }): void {
    // 정규화된 callback 으로 변환.
    switch (evt.type) {
      case "conversation.item.input_audio_transcription.completed": {
        const text = String(evt["transcript"] ?? "").trim();
        if (text) {
          this.lastSourceText = text;
          this.opts.emit.onSourceFinal(text, null);
        }
        return;
      }
      case "response.audio_transcript.done": {
        const text = String(evt["transcript"] ?? "").trim();
        if (text) this.opts.emit.onTranslationFinal(text);
        return;
      }
      case "response.text.done":
      case "response.output_text.done": {
        // Assist 응답 경로 (modalities: ['text']).
        const text = String(evt["text"] ?? evt["output_text"] ?? "").trim();
        if (text) this.opts.emit.onAssistText(text);
        return;
      }
      default:
        // partial / 기타 이벤트는 UI 가 원하면 보이도록 그대로 forward.
        this.opts.emit.emitRaw(evt);
    }
  }

  private send(obj: Record<string, unknown>): void {
    const ws = this.upstream;
    if (!ws || ws.readyState !== WSClient.OPEN) return;
    try {
      ws.send(JSON.stringify(obj));
    } catch (e) {
      this.opts.log.warn({ err: String(e) }, "openai_realtime_send_failed");
    }
  }

  sendAudio(chunk: Buffer): void {
    this.send({
      type: "input_audio_buffer.append",
      audio: chunk.toString("base64"),
    });
  }

  commit(): void {
    this.send({ type: "input_audio_buffer.commit" });
    this.send({ type: "response.create" });
  }

  interrupt(): void {
    this.send({ type: "response.cancel" });
  }

  async translate(_text: string): Promise<string> {
    // OpenAI Realtime 은 WS 스트림 안에서 자체 번역을 흘려보낸다 (response.audio_transcript.done).
    // 별도 번역 호출 불필요. 빈 문자열 반환 시 세션 핸들러가 기존 onTranslationFinal 콜백을 대기.
    return "";
  }

  async assist(intent: string, priorText?: string): Promise<void> {
    const prompt =
      ASSIST_SYSTEM_FOR_INTENT[intent] ?? ASSIST_SYSTEM_FOR_INTENT["assist"]!;
    const context = (priorText ?? this.lastSourceText).slice(0, 2000);
    this.send({
      type: "response.create",
      response: {
        modalities: ["text"],
        instructions: context ? `${prompt}\n\n직전 맥락:\n${context}` : prompt,
      },
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    const ws = this.upstream;
    this.upstream = null;
    if (!ws) return;
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
}

export const OpenAIRealtimeProvider: RealtimeProvider = {
  name: "openai",
  async start(opts) {
    const session = new OpenAISession(opts);
    await session.open();
    return session;
  },
};
