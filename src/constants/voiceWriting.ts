/** Default Volcengine Seed ASR 2.0 streaming resource (hourly billing). */
export const VOLC_ASR_DEFAULT_RESOURCE_ID = 'volc.seedasr.sauc.duration';

/** Upstream ASR WebSocket path (bidirectional bigmodel, optimized). */
export const VOLC_ASR_UPSTREAM_PATH = '/api/v3/sauc/bigmodel_async';

/** Same-origin Vite/Tauri proxy path for Volc ASR WebSocket. */
export const VOLC_ASR_PROXY_PATH = '/api/volc-asr';

/** MiniMax China OpenAPI host (proxied as /api/minimax). */
export const MINIMAX_API_ORIGIN = 'https://api.minimaxi.com';

export const MINIMAX_DEFAULT_TTS_MODEL = 'speech-2.6-turbo';

/** Common Mandarin system voice. */
export const MINIMAX_DEFAULT_VOICE_ID = 'male-qn-qingse';

export const VOICE_NOTE_OFFSET_X = 340;
export const VOICE_NOTE_OFFSET_Y = 48;
