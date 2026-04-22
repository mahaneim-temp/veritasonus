"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 마이크 캡처 + 16kHz/16-bit PCM 인코딩.
 * AudioWorklet이 가장 좋지만, 스캐폴드는 ScriptProcessorNode 기반 간략 구현 제공.
 * 게이트웨이 연결은 상위 훅에서 담당. 이 훅은 PCM 청크(ArrayBuffer)만 내보낸다.
 */
export function useMicrophone(opts?: {
  onChunk?: (chunk: ArrayBuffer) => void;
  source?: "mic" | "tab_audio";
}) {
  const [active, setActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);

  async function start() {
    if (active) return;
    let stream: MediaStream;
    if (opts?.source === "tab_audio") {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
          channelCount: 1,
        },
      });
    }
    streamRef.current = stream;

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 16000,
    });
    ctxRef.current = ctx;

    const source = ctx.createMediaStreamSource(stream);
    // eslint-disable-next-line deprecation/deprecation
    const proc = ctx.createScriptProcessor(2048, 1, 1);
    procRef.current = proc;
    source.connect(proc);
    proc.connect(ctx.destination);

    proc.onaudioprocess = (ev) => {
      if (muted) return;
      const input = ev.inputBuffer.getChannelData(0);
      const pcm = float32ToPCM16(input);
      opts?.onChunk?.(pcm.buffer as ArrayBuffer);
    };

    setActive(true);
  }

  function stop() {
    procRef.current?.disconnect();
    ctxRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    ctxRef.current = null;
    procRef.current = null;
    setActive(false);
  }

  useEffect(() => () => stop(), []);

  return { active, muted, setMuted, start, stop };
}

function float32ToPCM16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
