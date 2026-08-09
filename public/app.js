const startButton = document.querySelector('#start');
const subtitle = document.querySelector('#subtitle');
const statusLine = document.querySelector('#status');

function newSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `nick-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const state = {
  sessionId: newSessionId(),
  stream: null,
  audioContext: null,
  analyser: null,
  recorder: null,
  chunks: [],
  listening: false,
  recording: false,
  speaking: false,
  shouldProcess: false,
  speechStart: 0,
  lastVoice: 0,
  raf: 0,
  audioUnlocked: false
};

const SILENCE_MS = 850;
const MIN_SPEECH_MS = 420;
const MAX_RECORDING_MS = 18000;
const VOLUME_THRESHOLD = 0.026;

function setStatus(text) {
  statusLine.textContent = text;
}

function showSubtitle(text) {
  subtitle.textContent = text;
  subtitle.classList.toggle('visible', Boolean(text));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureSecureMicrophoneContext() {
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  if (!window.isSecureContext && !localHost) {
    throw new Error('En iPhone, abre Nick mediante la dirección HTTPS indicada por el Mac.');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('El navegador no permite acceder al micrófono desde esta dirección. Usa HTTPS.');
  }
  if (!globalThis.MediaRecorder) {
    throw new Error('Este navegador no dispone de grabación de audio compatible.');
  }
}

async function unlockIOSAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Este navegador no dispone de AudioContext.');

  if (!state.audioContext) state.audioContext = new AudioContextClass();
  if (state.audioContext.state === 'suspended') await state.audioContext.resume();

  // iOS exige que la salida de audio se active dentro del gesto de INICIAR.
  // Un buffer prácticamente silencioso desbloquea la reproducción posterior de Nick.
  const buffer = state.audioContext.createBuffer(1, 1, 22050);
  const source = state.audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(state.audioContext.destination);
  source.start(0);
  state.audioUnlocked = true;
}

async function playBase64Mp3(base64, text) {
  state.speaking = true;
  state.listening = false;
  if (state.recording) stopRecording(false);
  showSubtitle(text);
  setStatus('Nick habla');

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!state.audioContext) state.audioContext = new AudioContextClass();
    if (state.audioContext.state === 'suspended') await state.audioContext.resume();

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

    // Reproducimos la voz por el mismo AudioContext que iOS desbloqueó
    // al pulsar INICIAR. Evita el bloqueo de autoplay de un <audio> nuevo
    // después de esperar la respuesta de la red.
    const audioBuffer = await state.audioContext.decodeAudioData(bytes.buffer.slice(0));
    const source = state.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(state.audioContext.destination);

    await new Promise((resolve, reject) => {
      source.onended = resolve;
      try {
        source.start(0);
      } catch (error) {
        reject(error);
      }
    });
  } finally {
    await sleep(120);
    showSubtitle('');
    state.speaking = false;
    state.listening = true;
    setStatus('Escuchando');
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
}

async function beginMicrophone() {
  ensureSecureMicrophoneContext();

  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1
    }
  });

  if (!state.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContextClass();
  }
  if (state.audioContext.state === 'suspended') await state.audioContext.resume();

  const source = state.audioContext.createMediaStreamSource(state.stream);
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 1024;
  state.analyser.smoothingTimeConstant = 0.72;
  source.connect(state.analyser);
  monitorVoice();
}

function currentVolume() {
  const data = new Float32Array(state.analyser.fftSize);
  state.analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (const sample of data) sum += sample * sample;
  return Math.sqrt(sum / data.length);
}

function startRecording() {
  if (state.recording || state.speaking) return;

  state.chunks = [];

  const candidates = [
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm'
  ];

  const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type));

  if (!mimeType) {
    throw new Error('Este navegador no ofrece un formato de grabación compatible.');
  }

  state.recorder = new MediaRecorder(state.stream, { mimeType });

  state.recorder.ondataavailable = (event) => {
    if (event.data.size) state.chunks.push(event.data);
  };

  state.recorder.onstop = () => processRecording();

  state.recorder.start(250);
  state.recording = true;
  state.shouldProcess = true;
  state.speechStart = performance.now();
  state.lastVoice = performance.now();
  setStatus('Escuchando');
}

function stopRecording(process = true) {
  if (!state.recording || !state.recorder) return;
  state.recording = false;
  state.shouldProcess = process;
  if (state.recorder.state !== 'inactive') state.recorder.stop();
}

async function processRecording() {
  if (!state.shouldProcess || !state.chunks.length || state.speaking) return;
  state.listening = false;
  setStatus('Procesando');

  try {
    const mimeType = state.recorder?.mimeType || state.chunks[0]?.type || 'audio/mp4';
    const blob = new Blob(state.chunks, { type: mimeType });
    const form = new FormData();
    const extension = mimeType.includes('mp4') ? 'm4a' : 'webm';
    form.append('audio', blob, `speech.${extension}`);

    const transcription = await fetchJson('/api/transcribe', { method: 'POST', body: form });
    const text = transcription.text?.trim();
    if (!text || text.length < 2) {
      state.listening = true;
      setStatus('Escuchando');
      return;
    }

    setStatus(`Oído: ${text}`);
    const reply = await fetchJson('/api/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId, text })
    });
    await playBase64Mp3(reply.audio, reply.text);
  } catch (error) {
    console.error(error);
    setStatus(error.message);
    showSubtitle('Se ha producido un error técnico.');
    await sleep(1800);
    showSubtitle('');
    state.listening = true;
  }
}

function monitorVoice() {
  if (state.raf) cancelAnimationFrame(state.raf);

  const tick = () => {
    if (state.listening && !state.speaking && state.analyser) {
      const now = performance.now();
      const volume = currentVolume();
      if (volume > VOLUME_THRESHOLD) {
        if (!state.recording) startRecording();
        state.lastVoice = now;
      }
      if (state.recording) {
        const duration = now - state.speechStart;
        const silence = now - state.lastVoice;
        if ((duration > MIN_SPEECH_MS && silence > SILENCE_MS) || duration > MAX_RECORDING_MS) {
          stopRecording(true);
        }
      }
    }
    state.raf = requestAnimationFrame(tick);
  };
  tick();
}

async function start() {
  startButton.disabled = true;
  setStatus('Activando');
  try {
    ensureSecureMicrophoneContext();
    await unlockIOSAudio();
    await beginMicrophone();
    const opening = await fetchJson('/api/opening', { method: 'POST' });
    startButton.classList.add('hidden');
    await playBase64Mp3(opening.audio, opening.text);
  } catch (error) {
    console.error(error);
    startButton.disabled = false;
    setStatus(error.message);
    showSubtitle(error.message || 'No fue posible iniciar a Nick.');
  }
}

startButton.addEventListener('click', start);

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && state.audioContext?.state === 'suspended') {
    try { await state.audioContext.resume(); } catch (_) { /* iOS may require another gesture */ }
  }
});

document.addEventListener('keydown', async (event) => {
  if (event.key.toLowerCase() === 'f') {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  }
  if (event.key.toLowerCase() === 'r') {
    await fetchJson('/api/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId })
    });
    state.sessionId = newSessionId();
    setStatus('Conversación reiniciada');
  }
  if (event.key.toLowerCase() === 'e') {
    document.body.classList.toggle('rehearsal');
  }
});
