/**
 * Capture microphone PCM s16le @ 16 kHz for Volc ASR.
 */

export type MicCapture = {
  stop: () => void;
};

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
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

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

  return {
    stop() {
      try {
        processor.disconnect();
        source.disconnect();
      } catch {
        /* ignore */
      }
      void audioCtx.close();
      for (const track of stream.getTracks()) track.stop();
    },
  };
}
