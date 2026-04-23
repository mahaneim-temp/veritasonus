/**
 * 브랜드/서비스명 중앙 관리.
 * 나중에 서비스명을 변경할 때 이 파일 한 곳만 수정하면 된다.
 *
 * 현재 가정 브랜드: Veritasonus
 * (라틴: veritas(진실) + sonus(소리). 정식 확정 전까지 이 값 사용.)
 */

/** 메인 서비스명. 외부 노출(UI, 메타태그, 법적 문서 등)에 사용. */
export const BRAND_NAME = "Veritasonus";

/** 간단한 한 줄 슬로건. */
export const BRAND_TAGLINE = "중요한 대화를 위한 통역";

/** 법적 문서에서 사용하는 상호/서비스명. */
export const BRAND_LEGAL_NAME = "Veritasonus";

/** 운영사 (추후 변경). */
export const BRAND_OPERATOR = "TLTech";

/** 대표 도메인 (배포 후 실제 도메인으로 교체). */
export const BRAND_DOMAIN = "veritasonus.com";

/** 문의 이메일 (배포 후 실제 이메일로 교체). */
export const BRAND_SUPPORT_EMAIL = `support@${BRAND_DOMAIN}`;
