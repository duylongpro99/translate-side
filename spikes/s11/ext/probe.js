// Runs one TTS request from this extension page and reports what an adapter would see:
// status, content type, and (for audio) whether Chromium decodes it (decodeAudioData) and
// whether an <audio> element loads it (duration from loadedmetadata).
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Find the audio in a JSON body: Gemini Interactions, Gemini generateContent, Google Cloud TTS. */
function audioFromJson(json) {
  const step = (json.steps ?? []).filter((s) => s.type === 'model_output').flatMap((s) => s.content ?? []).filter((c) => c.type === 'audio').at(-1);
  if (step) return { mime: step.mime_type, bytes: b64ToBytes(step.data) };
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (part) return { mime: part.inlineData.mimeType, bytes: b64ToBytes(part.inlineData.data) };
  if (json.audioContent) return { mime: 'audio/mpeg', bytes: b64ToBytes(json.audioContent) };
  return null;
}

async function decode(bytes, mime) {
  const result = {};
  try {
    const ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(bytes.slice().buffer);
    Object.assign(result, { decoded: true, duration: Number(buf.duration.toFixed(2)), sampleRate: buf.sampleRate, channels: buf.numberOfChannels });
    await ctx.close();
  } catch (e) {
    result.decoded = false;
    result.decodeError = String(e);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  result.audioElement = await new Promise((resolve) => {
    const a = new Audio();
    a.onloadedmetadata = () => resolve({ loaded: true, duration: Number(a.duration.toFixed(2)) });
    a.onerror = () => resolve({ loaded: false, error: a.error?.code });
    a.src = url;
  });
  URL.revokeObjectURL(url);
  return result;
}

window.s11Call = async ({ url, method = 'POST', headers = {}, body }) => {
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(url, { method, headers, body });
  } catch (e) {
    return { fetchError: String(e) };
  }
  const contentType = res.headers.get('content-type') ?? '';
  const raw = new Uint8Array(await res.arrayBuffer());
  const out = { status: res.status, contentType, bytes: raw.length, ms: Math.round(performance.now() - t0) };
  let json;
  try { json = JSON.parse(new TextDecoder().decode(raw)); } catch { /* audio or text */ }
  if (json !== undefined) {
    const audio = res.ok ? audioFromJson(json) : null;
    if (audio) Object.assign(out, { audioMime: audio.mime, audioBytes: audio.bytes.length }, await decode(audio.bytes, audio.mime));
    else out.body = JSON.stringify(json).slice(0, 300);
  } else if (res.ok && /^audio\//.test(contentType)) {
    Object.assign(out, await decode(raw, contentType));
  } else {
    out.body = new TextDecoder().decode(raw).slice(0, 300);
  }
  return out;
};
