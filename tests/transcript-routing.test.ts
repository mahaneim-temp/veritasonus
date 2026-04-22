import { describe, it, expect } from "vitest";
import {
  routeTranscriptEvent,
  type TranscriptState,
} from "../realtime-gateway/src/transcript-routing";

describe("routeTranscriptEvent", () => {
  const initialState: TranscriptState = { utteranceSeq: 0 };

  it("assigns seq=1 on first transcription.completed", () => {
    const r = routeTranscriptEvent(initialState, {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "안녕하세요",
    });
    expect(r.nextState.utteranceSeq).toBe(1);
    expect(r.action).toEqual({
      kind: "write_source",
      seq: 1,
      text: "안녕하세요",
    });
  });

  it("monotonically increments seq for consecutive source utterances", () => {
    const s1 = routeTranscriptEvent(initialState, {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "first",
    });
    const s2 = routeTranscriptEvent(s1.nextState, {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "second",
    });
    expect(s1.nextState.utteranceSeq).toBe(1);
    expect(s2.nextState.utteranceSeq).toBe(2);
    expect(s2.action).toMatchObject({ kind: "write_source", seq: 2 });
  });

  it("routes audio_transcript.done as UPDATE on last utterance", () => {
    const afterSource = routeTranscriptEvent(initialState, {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "원문",
    });
    const r = routeTranscriptEvent(afterSource.nextState, {
      type: "response.audio_transcript.done",
      transcript: "translation",
    });
    expect(r.nextState.utteranceSeq).toBe(1);
    expect(r.action).toEqual({
      kind: "update_translation",
      seq: 1,
      text: "translation",
    });
  });

  it("pairs each translation with its own source row (no seq+0.5 leak)", () => {
    let state = initialState;
    const events = [
      {
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "원문1",
      },
      { type: "response.audio_transcript.done", transcript: "trans1" },
      {
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "원문2",
      },
      { type: "response.audio_transcript.done", transcript: "trans2" },
    ];
    const actions: string[] = [];
    for (const evt of events) {
      const r = routeTranscriptEvent(state, evt);
      state = r.nextState;
      if (r.action.kind !== "noop") {
        actions.push(`${r.action.kind}:${r.action.seq}:${r.action.text}`);
      }
    }
    expect(actions).toEqual([
      "write_source:1:원문1",
      "update_translation:1:trans1",
      "write_source:2:원문2",
      "update_translation:2:trans2",
    ]);
    expect(state.utteranceSeq).toBe(2);
  });

  it("noops on empty transcript", () => {
    const r = routeTranscriptEvent(initialState, {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "",
    });
    expect(r.nextState.utteranceSeq).toBe(0);
    expect(r.action).toMatchObject({ kind: "noop", reason: "empty_transcript" });
  });

  it("noops on whitespace-only transcript", () => {
    const r = routeTranscriptEvent(initialState, {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "   \n\t  ",
    });
    expect(r.action).toMatchObject({ kind: "noop", reason: "empty_transcript" });
  });

  it("noops on translation before any source (edge case)", () => {
    const r = routeTranscriptEvent(initialState, {
      type: "response.audio_transcript.done",
      transcript: "stranded translation",
    });
    expect(r.nextState.utteranceSeq).toBe(0);
    expect(r.action).toMatchObject({
      kind: "noop",
      reason: "translation_before_source",
    });
  });

  it("noops on empty translation", () => {
    const afterSource = routeTranscriptEvent(initialState, {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "원문",
    });
    const r = routeTranscriptEvent(afterSource.nextState, {
      type: "response.audio_transcript.done",
      transcript: "",
    });
    expect(r.action).toMatchObject({
      kind: "noop",
      reason: "empty_translation",
    });
  });

  it("noops on unhandled event type", () => {
    const r = routeTranscriptEvent(initialState, {
      type: "response.audio_transcript.delta",
      delta: "streaming chunk",
    });
    expect(r.nextState.utteranceSeq).toBe(0);
    expect(r.action).toMatchObject({ kind: "noop", reason: "unhandled_event" });
  });

  it("overwrites translation when same utterance gets audio_transcript.done twice", () => {
    // partial → final 같은 상황을 흉내. 두 번째 done 이 첫 번째를 덮어쓴다 (마지막 값 보존).
    let state = routeTranscriptEvent(initialState, {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "원문",
    }).nextState;
    const first = routeTranscriptEvent(state, {
      type: "response.audio_transcript.done",
      transcript: "initial",
    });
    state = first.nextState;
    const second = routeTranscriptEvent(state, {
      type: "response.audio_transcript.done",
      transcript: "corrected",
    });
    expect(first.action).toMatchObject({
      kind: "update_translation",
      seq: 1,
      text: "initial",
    });
    expect(second.action).toMatchObject({
      kind: "update_translation",
      seq: 1,
      text: "corrected",
    });
  });

  it("ignores non-string transcript fields safely", () => {
    const r = routeTranscriptEvent(initialState, {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: 12345 as unknown as string,
    });
    expect(r.action).toMatchObject({ kind: "noop", reason: "empty_transcript" });
  });

  it("is pure — does not mutate state arg", () => {
    const state: TranscriptState = { utteranceSeq: 3 };
    const frozen = Object.freeze({ ...state });
    routeTranscriptEvent(frozen, {
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "abc",
    });
    expect(state.utteranceSeq).toBe(3);
  });
});
