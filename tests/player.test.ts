import { describe, expect, it } from 'vitest';
import { Player } from '../src/player';
import type { TtsEngine } from '../src/tts/engine';
import type { Chapter } from '../src/types';

/** Motore finto: registra le frasi "lette" e le completa subito. */
function fakeEngine(spoken: string[]): TtsEngine {
  return {
    name: 'fake',
    isSupported: () => true,
    getVoices: async () => [],
    speak: async (t) => {
      spoken.push(t);
      await new Promise((r) => setTimeout(r, 1));
    },
    stop: () => {},
  };
}

const chapters: Chapter[] = [
  { title: 'A', paragraphs: [['a1', 'a2'], ['a3']] },
  { title: 'B', paragraphs: [['b1']] },
];
const opts = () => ({ rate: 1, pitch: 1, volume: 1, voiceURI: null, paragraphPause: 0 });

describe('Player', () => {
  it('legge tutto il libro in ordine e segnala la fine', async () => {
    const spoken: string[] = [];
    const p = new Player({ engine: fakeEngine(spoken), getOptions: opts });
    p.load(chapters, { chapter: 0, sentence: 0 });
    p.play();
    await new Promise<void>((resolve) => p.subscribe((s) => s.finished && resolve()));
    expect(spoken).toEqual(['a1', 'a2', 'a3', 'b1']);
  });

  it('riprende dalla posizione salvata', async () => {
    const spoken: string[] = [];
    const p = new Player({ engine: fakeEngine(spoken), getOptions: opts });
    p.load(chapters, { chapter: 0, sentence: 2 });
    p.play();
    await new Promise<void>((resolve) => p.subscribe((s) => s.finished && resolve()));
    expect(spoken).toEqual(['a3', 'b1']);
  });

  it('timer fine capitolo mette in pausa', async () => {
    const spoken: string[] = [];
    const p = new Player({ engine: fakeEngine(spoken), getOptions: opts });
    p.load(chapters, { chapter: 0, sentence: 0 });
    p.setSleep('chapter');
    p.play();
    await new Promise<void>((resolve) => p.subscribe((s) => !s.playing && spoken.length > 0 && resolve()));
    expect(spoken).toEqual(['a1', 'a2', 'a3']);
    expect(p.state.position).toEqual({ chapter: 1, sentence: 0 });
  });

  it('i salti restano nei limiti', () => {
    const p = new Player({ engine: fakeEngine([]), getOptions: opts });
    p.load(chapters, { chapter: 5, sentence: 99 });
    expect(p.state.position).toEqual({ chapter: 1, sentence: 0 });
    p.prevSentence();
    expect(p.state.position).toEqual({ chapter: 0, sentence: 2 });
    p.nextChapter();
    p.nextChapter();
    expect(p.state.position).toEqual({ chapter: 1, sentence: 0 });
  });
});
