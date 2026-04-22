/**
 * Provider 선택 팩토리. env `REALTIME_PROVIDER` 로 런타임 결정.
 */

import type { RealtimeProvider } from "./types.js";
import { OpenAIRealtimeProvider } from "./openai-realtime.js";
import { GoogleProvider } from "./google.js";
import { ENV } from "../env.js";

export function selectProvider(): RealtimeProvider {
  return ENV.REALTIME_PROVIDER === "google"
    ? GoogleProvider
    : OpenAIRealtimeProvider;
}

export { OpenAIRealtimeProvider, GoogleProvider };
export type { RealtimeProvider } from "./types.js";
