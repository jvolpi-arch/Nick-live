import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import { loadKnowledge, retrieve } from './knowledge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const prompt = await fs.readFile(
  path.join(rootDir, 'brain', 'prompt.md'),
  'utf8'
);

const identity = await fs.readFile(
  path.join(rootDir, 'brain', 'identity.md'),
  'utf8'
);

const voice = await fs.readFile(
  path.join(rootDir, 'brain', 'voice.md'),
  'utf8'
);




console.log('Cargando la novela…');
const knowledge = await loadKnowledge(rootDir);
console.log(`Novela cargada: ${knowledge.length} fragmentos.`);

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));

const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) {
    sessions.set(id, {
      history: [],
      memory: ''
    });
  }
  return sessions.get(id);
}

function trimTo50Words(text) {
  const cleaned = text.trim().replace(/^['“”]|['“”]$/g, '');
  const words = cleaned.split(/\s+/);
  if (words.length <= 50) return cleaned;
  return `${words.slice(0, 50).join(' ').replace(/[,:;–—-]+$/, '')}.`;
}

async function synthesizeSpeech(text) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'content-type': 'application/json',
      accept: 'audio/mpeg'
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      language_code: 'es',
      voice_settings: {
  stability: 0.70,
  similarity_boost: 0.88,
  style: 0.05,
  use_speaker_boost: true,
  speed: 1.08
}
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`ElevenLabs ${response.status}: ${details}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, knowledgeChunks: knowledge.length });
});

app.post('/api/opening', async (_req, res) => {
  try {
    const text = 'Mi nombre es Nick. Consejerconst text = 'Mi nombre es Nick. Consejero político...';

console.log("➡️ Enviando a ElevenLabs...");

const audio = await synthesizeSpeech(text);

console.log("✅ Audio generado:", audio.length);

res.json({
  text,
  audio: audio.toString("base64")
});
    res.json({ text, audio: audio.toString('base64') });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió audio.' });

console.log("========== AUDIO RECIBIDO ==========");
console.log("Nombre:", req.file.originalname);
console.log("MIME:", req.file.mimetype);
console.log("Tamaño:", req.file.size);

    const file = new File([req.file.buffer], req.file.originalname || 'speech.webm', {
      type: req.file.mimetype || 'audio/webm'
    });
console.log("Enviando audio a OpenAI...");
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
      language: 'es',
      prompt: 'Conversación sobre la novela La República. Nombres: Nick, Jorge Volpi, Igne Kayris, VM Lively, Leo Klein, Paul O’Keeffe.'
    });
    console.log("Transcripción:", transcription.text);
    res.json({ text: transcription.text?.trim() || '' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/respond', async (req, res) => {
  try {
    const { sessionId, text } = req.body ?? {};
    if (!sessionId || !text?.trim()) return res.status(400).json({ error: 'Faltan sessionId o texto.' });

    const session = getSession(sessionId);
    const relevant = retrieve(knowledge, text, 3);
    const documentaryContext = relevant.length
      ? relevant.map((item) => `[Fragmento ${item.id}]\n${item.text}`).join('\n\n---\n\n')
      : 'No se recuperaron fragmentos específicos del manuscrito para esta pregunta.';

    const conversation = session.history
  .slice(-6)
  .map((turn) => `${turn.role === 'user' ? 'JORGE/PÚBLICO' : 'NICK'}: ${turn.content}`)
  .join('\n');



const input = `
${prompt}

${identity}

${voice}

## MEMORIA DE LA CONVERSACIÓN

${session.memory || "(todavía no hay observaciones relevantes)"}

## CONTEXTO DOCUMENTAL

${documentaryContext}

## CONVERSACIÓN RECIENTE

${conversation || "(inicio de conversación)"}

INTERLOCUTOR:

${text}

Responde como Nick.

Máximo 50 palabras.
`;

    const response = await openai.responses.create({
  model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
  input,
  reasoning: { effort: 'minimal' },
  max_output_tokens: 300
});

console.log("========== RESPUESTA OPENAI ==========");
console.dir(response, { depth: 5 });
console.log("======================================");

const answer = trimTo50Words(
  response.output_text || 'Algunas preguntas contienen más incertidumbre que respuestas.'
);
    session.history.push({ role: 'user', content: text.trim() });
    session.history.push({ role: 'assistant', content: answer });
    if (session.history.length > 30) session.history = session.history.slice(-30);

    const audio = await synthesizeSpeech(answer);
    res.json({ text: answer, audio: audio.toString('base64') });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/reset', (req, res) => {
  const { sessionId } = req.body ?? {};
  if (sessionId) sessions.delete(sessionId);
  res.json({ ok: true });
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Nick está disponible en http://localhost:${port}`);
});
