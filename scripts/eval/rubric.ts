// The 1–5 rubric (plan M2-E8, DESIGN.md §10). One source for the human sheet, the judge prompt and the report.
export const DIMENSIONS = ['fidelity', 'naturalness', 'tone', 'terminology'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface RubricEntry {
  question: string;
  /** What a 1, a 3 and a 5 look like; 2 and 4 sit between them. */
  anchors: { 1: string; 3: string; 5: string };
}

export const RUBRIC: Record<Dimension, RubricEntry> = {
  fidelity: {
    question: 'Are the meaning and intent of the source kept?',
    anchors: {
      1: 'Meaning is wrong or missing in several places; content added, dropped or invented; code, URLs or markers damaged.',
      3: 'Main message is right, but some details are lost, softened or shifted, or one clear mistranslation.',
      5: 'Everything the source says is there, nothing added; code, numbers, names and links intact.',
    },
  },
  naturalness: {
    question: 'Does it read like text written in the target language, not translated?',
    anchors: {
      1: 'Word-for-word calques; unnatural word order; a native reader would stumble in most sentences.',
      3: 'Understandable and mostly grammatical, but with noticeable translationese in places.',
      5: 'Fluent and idiomatic throughout; a native reader would not guess it is a translation.',
    },
  },
  tone: {
    question: 'Are register, voice, humor, sarcasm and attitude of the source kept?',
    anchors: {
      1: 'Tone is lost or inverted: sarcasm taken literally, humor flattened, formal text made casual (or the reverse).',
      3: 'Register is roughly right, but the humor, irony or emphasis is weakened or only partly carried over.',
      5: 'Voice, register and any irony or humor come across as in the source, with idioms re-created, not translated literally.',
    },
  },
  terminology: {
    question: 'Are technical terms and names rendered correctly and consistently?',
    anchors: {
      1: 'Key terms are mistranslated, or one term has several different renderings within the passage.',
      3: 'Most terms are right, with a few awkward, inconsistent or needlessly translated ones.',
      5: 'Terms follow the usual usage of the target-language technical community (or are kept in English where that is the norm), and are consistent.',
    },
  },
};

export function rubricMarkdown(): string {
  return DIMENSIONS.map((d) => {
    const r = RUBRIC[d];
    return `**${d}** — ${r.question}\n- 1: ${r.anchors[1]}\n- 3: ${r.anchors[3]}\n- 5: ${r.anchors[5]}`;
  }).join('\n\n');
}
