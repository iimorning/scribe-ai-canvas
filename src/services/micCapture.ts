/**
 * Capture microphone PCM s16le @ 16 kHz for Volc ASR.
 */

export type MicCapture = {
  stop: () => Promise<void>;
};

/**
 * Like `navigator.mediaDevices.getUserMedia(...)` but cancellable. `getUserMedia` itself
 * doesn't honor AbortSignal — we pipe through `signal` so a stop() that races with a still-
 * pending capture can short-circuit before the user gets a "permission denied" microtask storm.
 */
function getUserMediaCancellable(
  constraints: MediaStreamConstraints,
  signal: AbortSignal,
): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((stream) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          for (const track of stream.getTracks()) track.stop();
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        resolve(stream);
      })
      .catch((err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      });
  });
}

function downsampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === 16000) return input;
  const ratio = inputSampleRate / 16000;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    out[i] = input[start] ?? 0;
  }
  return out;
}

function floatTo16BitPcm(float32: Float32Array): Uint8Array {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]!));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

export async function startMicCapture(onPcm: (pcm: Uint8Array) => void): Promise<MicCapture> {
  const abort = new AbortController();
  const stream = await getUserMediaCancellable(
    {
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    },
    abort.signal,
  );

  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  // ~200ms at context rate → good for Volc packet sizing after downsample
  const bufferSize = 4096;
  const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const down = downsampleTo16k(input, audioCtx.sampleRate);
    if (down.length === 0) return;
    onPcm(floatTo16BitPcm(down));
  };

  source.connect(processor);
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  processor.connect(mute);
  mute.connect(audioCtx.destination);

  let stopped = false;
  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      // Signal the still-pending getUserMedia (if any) — once everything is resolved this is
      // a no-op, but it prevents a half-resolved capture from injecting a callback after stop.
      abort.abort();
      // Disconnect the entire audio graph BEFORE closing the context so the nodes aren't
      // retained by the context's node graph during teardown. ScriptProcessor and mute both
      // hold references; the destination-attached mute in particular would otherwise linger.
      try {
        processor.disconnect();
      } catch {
        /* already disconnected */
      }
      try {
        source.disconnect();
      } catch {
        /* already disconnected */
      }
      try {
        mute.disconnect();
      } catch {
        /* already disconnected */
      }
      // Release the mic tracks synchronously so the OS-level mic indicator turns off even if
      // the AudioContext close promise is still in flight.
      for (const track of stream.getTracks()) track.stop();
      // Await the close so a subsequent startMicCapture can open a fresh context without
      // racing toward the browser's per-page AudioContext quota.
      try {
        await audioCtx.close();
      } catch {
        /* context may already be closed */
      }
    },
  };
}
