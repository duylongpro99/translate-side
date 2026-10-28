// One-off: asks Gemini for ~300 Vietnamese test sentences and writes ../corpus-vi.json.
// The committed corpus is the source of truth; re-running this produces a different corpus.
import { writeFileSync } from 'node:fs';
import { generate } from './gemini.mjs';

const MODEL = process.argv[2] ?? 'gemini-3.5-flash';
// --heldout: a second, independent set written after the G2P was tuned, to check the rules generalise.
const HELDOUT = process.argv.includes('--heldout');
const groups = HELDOUT
  ? [
      ['news', 60, 'Vietnamese online news sentences (politics, economy, sport, culture, science), with Vietnamese personal and place names (Nguyễn, Trần, Đà Nẵng, Quảng Ngãi, Buôn Ma Thuột...).'],
      ['web prose', 60, 'Sentences from Vietnamese blogs, recipes, product pages, how-to guides and encyclopedia articles, with numbers written as digits where natural.'],
    ]
  : [
  ['tones', 60, 'Every sentence mixes all six tones (ngang, huyền, sắc, hỏi, ngã, nặng); include minimal pairs like ma/má/mà/mả/mã/mạ and checked syllables (sắc/nặng with final p, t, c, ch).'],
  ['vowel clusters', 60, 'Stress the diphthongs and triphthongs: ia/iê/yê, ua/uô, ưa/ươ, ươi, uôi, iêu, yêu, oai, oay, uây, uyê, oă, oe, uê, uy, uơ, au/âu, ay/ây, eo, êu, iu, ưu, ơi, ưi.'],
  ['finals and onsets', 60, 'Stress every final (m, n, ng, nh, p, t, c, ch, i/y, o/u) and every onset (b, c/k/q, ch, d, đ, g/gh, gi, h, kh, l, m, n, ng/ngh, nh, p, ph, qu, r, s, t, th, tr, v, x) including words like giường, gì, nghiêng, quốc, quyển, khuỷu, ngoằng.'],
  ['everyday prose', 70, 'Plain everyday and news-style prose about varied topics (weather, food, school, work, travel, health, technology described in Vietnamese words), 8 to 25 words each.'],
      ['numbers', 50, 'Each sentence contains one or more numbers written as DIGITS: years (1945, 2024), counts (3, 15, 21, 105, 1000, 2.500.000 with dots as thousands separators), times like 7 giờ, percentages written as words (phần trăm). No decimals with commas, no phone numbers.'],
    ];
const out = [];
for (const [name, n, brief] of groups) {
  const prompt = `Write ${n} distinct natural Vietnamese sentences in standard Northern (Hà Nội) spelling with full diacritics. ${brief}
Rules: Vietnamese words only (no English words, brand names, acronyms or Latin letters outside Vietnamese words). Use normal punctuation (. , ? !). Return a JSON array of strings, nothing else.`;
  const text = await generate(MODEL, [{ text: prompt }], { json: true, temperature: 0.9, thinking: { thinkingLevel: 'low' } });
  const arr = JSON.parse(text);
  for (const s of arr) out.push({ group: name, text: String(s).trim() });
  console.error(name, arr.length);
}
writeFileSync(new URL(HELDOUT ? '../corpus-vi-heldout.json' : '../corpus-vi.json', import.meta.url), JSON.stringify({ model: MODEL, created: new Date().toISOString(), sentences: out }, null, 1) + '\n');
console.error('total', out.length);
