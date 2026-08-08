const startButton = document.querySelector('#start');
const DEBUG = new URLSearchParams(window.location.search).has('debug');
const subtitle = document.querySelector('#subtitle');
const statusLine = document.querySelector('#status');

const state = {
  sessionId: crypto.randomUUID(),
  stream: null,
  audioContext: null,
  analyser: null,
  recorder: null,
  chunks: [],
  listening: false,
  recording: false,
  speaking: false,
  speechStart: 0,
  lastVoice: 0,
  raf: 0
};

const SILENCE_MS = 850;
const MIN_SPEECH_MS = 420;
const MAX_RECORDING_MS = 18000;
const VOLUME_THRESHOLD = 0.026;

function setStatus(text) {
  statusLine.textContent = text;
}
function debug(step, value = "") {
  if (!DEBUG) return;

  console.log(`[DEBUG] ${step}`, value);

  let panel = document.getElementById("debug");

  if (!panel) {
    panel = document.createElement("pre");
    panel.id = "debug";

    panel.style.position = "fixed";
    panel.style.bottom = "10px";
    panel.style.left = "10px";
    panel.style.width = "420px";
    panel.style.maxHeight = "250px";
    panel.style.overflow = "auto";

    panel.style.background = "rgba(0,0,0,.82)";
    panel.style.color = "#7CFC00";

    panel.style.padding = "12px";
    panel.style.fontFamily = "Menlo, monospace";
    panel.style.fontSize = "12px";

    panel.style.zIndex = "999999";

    document.body.appendChild(panel);
  }

  panel.textContent += `${step} ${value}\n`;
  panel.scrollTop = panel.scrollHeight;
}
function showSubtitle(text) {
  subtitle.textContent = text;
  subtitle.classList.toggle('visible', Boolean(text));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function playBase64Mp3(base64, text) {
  state.speaking = true;
  state.listening = false;
  if (state.recording) stopRecording(false);
  showSubtitle(text);
  setStatus('Nick habla');

  const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
  await audio.play();
  await new Promise((resolve) => {
    audio.addEventListener('ended', resolve, { once: true });
    audio.addEventListener('error', resolve, { once: true });
  });
  await sleep(120);
  showSubtitle('');
  state.speaking = false;
  state.listening = true;
  setStatus('Escuchando');
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
}

async function beginMicrophone() {
  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1
    }
  });

  state.audioContext = new AudioContext();
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
    'audio/webm;codecs=opus',
    'audio/mp4',
    'audio/webm'
  ];

  const mimeType = candidates.find((type) =>
    MediaRecorder.isTypeSupported(type)
  );

  if (!mimeType) {
    throw new Error('Este navegador no ofrece un formato de grabación compatible.');
  }

  state.recorder = new MediaRecorder(state.stream, { mimeType });

  state.recorder.ondataavailable = (event) => {
    if (event.data.size) state.chunks.push(event.data);
  };

  state.recorder.onstop = () => processRecording();

  state.recorder.start(150);
  state.recording = true;
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
    const blob = new Blob(state.chunks, { type: state.recorder.mimeType });
    const form = new FormData();
    const extension = state.recorder.mimeType.includes('mp4') ? 'm4a' : 'webm';
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

  debug("🚀 Inicio");

  startButton.disabled = true;
  setStatus('Activando');

  try {

    await beginMicrophone();

    const opening = await fetchJson('/api/opening', {
      method: 'POST'
    });

    startButton.classList.add('hidden');

    await playBase64Mp3(opening.audio, opening.text);

  } catch (error) {

    console.error(error);

    startButton.disabled = false;

    setStatus(error.message);

    showSubtitle('No fue posible iniciar a Nick.');

  }
}

startButton.addEventListener('click', start);

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
    state.sessionId = crypto.randomUUID();
    setStatus('Conversación reiniciada');
  }
  if (event.key.toLowerCase() === 'e') {
    document.body.classList.toggle('rehearsal');
  }
});
