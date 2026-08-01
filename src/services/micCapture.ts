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
  // Some browsers start the context suspended (autoplay policy). If suspended, onaudioprocess
  // fires with zero-filled input buffers → silent PCM → ASR VAD never fires → no results.
  if (audioCtx.state === 'suspended') {
    console.log('[Spoor Mic] AudioContext suspended, resuming');
    try {
      await audioCtx.resume();
    } catch (e) {
      console.warn('[Spoor Mic] resume failed', e);
    }
  }
  console.log('[Spoor Mic] AudioContext state', audioCtx.state, 'sampleRate', audioCtx.sampleRate);

  // Diagnostics: is the mic track actually live and enabled? Silent input often means the
  // OS granted a muted/virtual device, or the browser picked the wrong default input.
  const tracks = stream.getAudioTracks();
  console.log('[Spoor Mic] tracks', tracks.length, JSON.stringify(tracks.map((t) => ({
    kind: t.kind,
    enabled: t.enabled,
    muted: t.muted,
    readyState: t.readyState,
    label: t.label,
    settings: t.getSettings(),
  })), null, 2));
  console.log('[Spoor Mic] stream.active', stream.active);
  tracks.forEach((t) => {
    t.onmute = () => console.warn('[Spoor Mic] track muted by system', t.label);
    t.onunmute = () => console.log('[Spoor Mic] track unmuted', t.label);
    t.onended = () => console.warn('[Spoor Mic] track ended', t.label);
  });

  const source = audioCtx.createMediaStreamSource(stream);

  // Bypass sanity check: an AnalyserNode reads the same source independently of the
  // ScriptProcessor. If the analyser sees signal but the processor doesn't, it's a code bug;
  // if both see silence, it's the device/OS.
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const analyserBuf = new Uint8Array(analyser.frequencyBinCount);
  let analyserChecked = 0;
  const analyserTimer = setInterval(() => {
    analyser.getByteTimeDomainData(analyserBuf);
    let max = 0;
    for (let i = 0; i < analyserBuf.length; i++) {
      const v = Math.abs(analyserBuf[i]! - 128);
      if (v > max) max = v;
    }
    analyserChecked += 1;
    if (analyserChecked <= 5 || analyserChecked % 20 === 0) {
      console.log('[Spoor Mic] analyser peak (0=silence, 128=loud)', max);
    }
  }, 500);
  // ~200ms at context rate → good for Volc packet sizing after downsample
  const bufferSize = 4096;
  const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);

  let pcmCount = 0;
  let silentStreak = 0;
  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    const down = downsampleTo16k(input, audioCtx.sampleRate);
    if (down.length === 0) return;
    const pcm = floatTo16BitPcm(down);
    pcmCount += 1;
    // rms + peak: rms=0 with peak=0 means the buffer is literally all zeros (device silence),
    // not just a quiet room. Log more precision so a tiny signal isn't rounded away.
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < input.length; i++) {
      const v = input[i]!;
      sumSq += v * v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    const rms = input.length > 0 ? Math.sqrt(sumSq / input.length) : 0;
    if (rms < 0.0001) silentStreak += 1; else silentStreak = 0;
    if (pcmCount <= 3 || pcmCount % 50 === 0 || (silentStreak === 5)) {
      console.log('[Spoor Mic] onaudioprocess', { n: pcmCount, samples: down.length, bytes: pcm.length, sampleRate: audioCtx.sampleRate, rms: rms.toFixed(6), peak: peak.toFixed(6) });
    }
    if (silentStreak === 5) {
      console.warn('[Spoor Mic] 5 consecutive silent frames — mic device may be muted, wrong default device, or blocked by OS privacy settings. Check: Windows 麦克风隐私设置 / 浏览器地址栏麦克风权限 / 默认录音设备');
    }
    onPcm(pcm);
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
      clearInterval(analyserTimer);
      try {
        analyser.disconnect();
      } catch {
        /* ignore */
      }
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
