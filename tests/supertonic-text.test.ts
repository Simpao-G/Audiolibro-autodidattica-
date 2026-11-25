import { describe, expect, it } from 'vitest';
import { preprocess, toIds } from '../src/tts/supertonic/text';

describe('Supertonic: preparazione testo', () => {
  it('aggiunge il tag della lingua e il punto finale', () => {
    expect(preprocess('Ciao a tutti')).toBe('<it>Ciao a tutti.</it>');
  });

  it('normalizza virgolette, trattini e spazi', () => {
    expect(preprocess('«Vieni» — disse  , poi “andò” !')).toBe('<it>"Vieni" - disse, poi "andò"!</it>'.normalize('NFKD'));
  });

  it('scompone gli accenti (NFKD) e rimuove le emoji', () => {
    const out = preprocess('Perché è così 😀');
    expect(out).toBe('<it>Perché è così.</it>'.normalize('NFKD'));
    expect(out).not.toContain('😀');
  });

  it('converte in id saltando i caratteri sconosciuti', () => {
    const indexer = new Array(200).fill(-1);
    indexer['a'.codePointAt(0)!] = 5;
    indexer['b'.codePointAt(0)!] = 6;
    expect(toIds('abz', indexer)).toEqual([5, 6]);
  });
});

import { bestItalianVoice, voiceScore } from '../src/tts/webspeech';

describe('Voci del dispositivo: scelta automatica', () => {
  const voices = [
    { name: 'Alice', lang: 'it-IT' },
    { name: 'Microsoft Elsa Online (Natural) - Italian (Italy)', lang: 'it-IT' },
    { name: 'Google UK English Female', lang: 'en-GB' },
    { name: 'eSpeak Italian', lang: 'it' },
  ];
  it('preferisce le voci italiane di qualità', () => {
    expect(bestItalianVoice(voices)?.name).toContain('Natural');
    expect(voiceScore(voices[3])).toBeLessThan(voiceScore(voices[0]));
  });
  it('riconosce le voci Premium di iOS', () => {
    const v = bestItalianVoice([{ name: 'Alice', lang: 'it-IT' }, { name: 'Federica (Premium)', lang: 'it-IT' }]);
    expect(v?.name).toBe('Federica (Premium)');
  });
});
