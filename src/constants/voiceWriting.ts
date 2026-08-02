/** Default Volcengine Seed ASR 2.0 streaming resource (hourly billing). */
export const VOLC_ASR_DEFAULT_RESOURCE_ID = 'volc.seedasr.sauc.duration';

/** Upstream ASR WebSocket path (bidirectional bigmodel, optimized). */
export const VOLC_ASR_UPSTREAM_PATH = '/api/v3/sauc/bigmodel_async';

/** Same-origin Vite/Tauri proxy path for Volc ASR WebSocket. */
export const VOLC_ASR_PROXY_PATH = '/api/volc-asr';

/**
 * Silence (ms) before Volc ASR marks an utterance `definite` for transcript quality.
 * Turns are committed only when the user manually closes the mic — this does not end a turn.
 */
export const VOLC_ASR_END_WINDOW_MS = 2200;

/** MiniMax China OpenAPI host (proxied as /api/minimax). */
export const MINIMAX_API_ORIGIN = 'https://api.minimaxi.com';

export const MINIMAX_DEFAULT_TTS_MODEL = 'speech-2.6-turbo';

/** Common Mandarin system voice. */
export const MINIMAX_DEFAULT_VOICE_ID = 'Chinese (Mandarin)_Gentle_Senior';

export const VOICE_NOTE_COLUMN_GAP_X = 360;
/** Vertical gap between rows in the two-column voice layout (card height + spacing). */
export const VOICE_NOTE_ROW_GAP_Y = 260;
