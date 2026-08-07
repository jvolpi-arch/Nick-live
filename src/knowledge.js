import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';

const STOPWORDS = new Set([
  'a','al','algo','ante','como','con','contra','cual','cuando','de','del','desde','donde','dos','el','ella','ellos','en','entre','era','es','esa','ese','eso','esta','este','esto','fue','ha','hay','la','las','le','les','lo','los','más','me','mi','muy','no','nos','o','para','pero','por','que','se','sin','sobre','son','su','sus','te','tu','un','una','uno','y','ya'
]);

function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñáéíóúü\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function terms(text) {
  return normalize(text)
    .split(' ')
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function chunkText(text, target = 1800, overlap = 250) {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if ((current + '\n\n' + paragraph).length <= target) {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
      continue;
    }

    if (current) chunks.push(current);
    const tail = current.slice(-overlap);
    current = tail ? `${tail}\n\n${paragraph}` : paragraph;

    while (current.length > target * 1.5) {
      chunks.push(current.slice(0, target));
      current = current.slice(target - overlap);
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export async function loadKnowledge(rootDir) {
  const docxPath = path.join(rootDir, 'knowledge', 'La_Republica.docx');
  const result = await mammoth.extractRawText({ path: docxPath });
  const chunks = chunkText(result.value);

  return chunks.map((text, index) => {
    const tokenList = terms(text);
    const counts = new Map();
    for (const token of tokenList) counts.set(token, (counts.get(token) ?? 0) + 1);
    return { id: index + 1, text, counts };
  });
}

export function retrieve(chunks, query, limit = 6) {
  const queryTerms = terms(query);
  if (!queryTerms.length) return [];

  return chunks
    .map((chunk) => {
      let score = 0;
      for (const term of queryTerms) {
        const frequency = chunk.counts.get(term) ?? 0;
        if (frequency) score += 1 + Math.log(frequency);
        if (chunk.text.toLowerCase().includes(term)) score += 0.35;
      }
      return { ...chunk, score };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
