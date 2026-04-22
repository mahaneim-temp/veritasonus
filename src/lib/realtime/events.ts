/**
 * 이벤트 타입의 "공용 재노출". realtime-gateway도 이 파일을 직접 참조하도록
 * (pnpm workspace alias 또는 복제) 한다.
 */
export type { ServerEvent, ClientEvent } from "@/types/realtime";
export { GATEWAY_PROTOCOL_VERSION } from "@/types/realtime";
