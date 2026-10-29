// One-off: asks Gemini for 120 English web-prose sentences and writes ../corpus-en.json (for the en G2P comparison).
import { writeFileSync } from 'node:fs';
import { generate } from './gemini.mjs';

const MODEL = process.argv[2] ?? 'gemini-3.5-flash';
const prompt = `Write 120 distinct English sentences of the kind found on web pages a reader translates: news, blog posts, documentation, product pages, Wikipedia. 8 to 30 words each, varied vocabulary (including less common words, names of places, technical terms), some with numbers written as digits (years, counts, prices like $25, percentages like 40%). Return a JSON array of strings, nothing else.`;
const arr = JSON.parse(await generate(MODEL, [{ text: prompt }], { json: true, temperature: 0.9, thinking: { thinkingLevel: 'low' } }));
writeFileSync(
  new URL('../corpus-en.json', import.meta.url),
  JSON.stringify({ model: MODEL, created: new Date().toISOString(), sentences: arr.map((t) => ({ text: String(t).trim() })) }, null, 1) + '\n',
);
console.error('total', arr.length);
