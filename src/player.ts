import type { Chapter, Position } from './types';
import type { SpeakOptions, TtsEngine } from './tts/engine';
import { flatSentences } from './text';

export type SleepMode = null | 'chapter' | number; // number = timestamp di fine

export interface PlayerState {
  playing: boolean;
  /** In riproduzione ma l'audio non è ancora partito (es. la voce AI sta generando). */
  buffering: boolean;
  position: Position;
  sleep: SleepMode;
  error: string | null;
  finished: boolean;
}

export interface PlayerDeps {
  engine: TtsEngine;
  getOptions: () => SpeakOptions & { paragraphPause: number };
  onPosition?: (p: Position) => void;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Quante frasi preparare in anticipo (per i motori che generano audio). */
const PREFETCH = 3;

/** Gestisce la coda di frasi: play/pausa, salti, timer di spegnimento. */
export class Player {
  private chapters: Chapter[] = [];
  private sentences: string[][] = [];
  private paragraphEnds: Set<number>[] = [];
  private gen = 0;
  private listeners = new Set<(s: PlayerState) => void>();
  private sleepTimer: number | undefined;
  state: PlayerState = { playing: false, buffering: false, position: { chapter: 0, sentence: 0 }, sleep: null, error: null, finished: false };

  constructor(private deps: PlayerDeps) {}

  load(chapters: Chapter[], position: Position): void {
    this.stopInternal();
    this.chapters = chapters;
    this.sentences = chapters.map(flatSentences);
    this.paragraphEnds = chapters.map((c) => {
      const ends = new Set<number>();
      let n = 0;
      for (const p of c.paragraphs) ends.add((n += p.length) - 1);
      return ends;
    });
    this.set({ position: this.clamp(position), playing: false, error: null, finished: false });
  }

  get chapterCount(): number {
    return this.chapters.length;
  }

  sentenceCount(chapter: number): number {
    return this.sentences[chapter]?.length ?? 0;
  }

  subscribe(fn: (s: PlayerState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  play(): void {
    if (this.state.playing || !this.chapters.length) return;
    if (this.state.finished) this.state.position = { chapter: 0, sentence: 0 };
    // Siamo dentro il tocco dell'utente: sblocca l'audio (necessario su iOS)
    this.deps.engine.unlock?.();
    this.set({ playing: true, buffering: true, error: null, finished: false });
    this.run(++this.gen);
  }

  pause(): void {
    if (!this.state.playing) return;
    this.stopInternal();
    this.set({ playing: false, buffering: false });
  }

  toggle(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  seek(position: Position): void {
    const wasPlaying = this.state.playing;
    this.stopInternal();
    this.set({ position: this.clamp(position), playing: false, finished: false });
    this.deps.onPosition?.(this.state.position);
    if (wasPlaying) this.play();
  }

  nextSentence(): void {
    const { chapter, sentence } = this.state.position;
    if (sentence + 1 < this.sentenceCount(chapter)) this.seek({ chapter, sentence: sentence + 1 });
    else if (chapter + 1 < this.chapterCount) this.seek({ chapter: chapter + 1, sentence: 0 });
  }

  prevSentence(): void {
    const { chapter, sentence } = this.state.position;
    if (sentence > 0) this.seek({ chapter, sentence: sentence - 1 });
    else if (chapter > 0) this.seek({ chapter: chapter - 1, sentence: Math.max(0, this.sentenceCount(chapter - 1) - 1) });
  }

  nextChapter(): void {
    const { chapter } = this.state.position;
    if (chapter + 1 < this.chapterCount) this.seek({ chapter: chapter + 1, sentence: 0 });
  }

  /** Se si è oltre le prime frasi torna all'inizio del capitolo, altrimenti al precedente. */
  prevChapter(): void {
    const { chapter, sentence } = this.state.position;
    if (sentence > 2 || chapter === 0) this.seek({ chapter, sentence: 0 });
    else this.seek({ chapter: chapter - 1, sentence: 0 });
  }

  /** null = disattivato, 'chapter' = fine capitolo, numero = minuti. */
  setSleep(mode: null | 'chapter' | number): void {
    clearTimeout(this.sleepTimer);
    if (typeof mode === 'number') {
      const end = Date.now() + mode * 60_000;
      this.sleepTimer = window.setTimeout(() => {
        this.pause();
        this.set({ sleep: null });
      }, mode * 60_000);
      this.set({ sleep: end });
    } else {
      this.set({ sleep: mode });
    }
  }

  destroy(): void {
    this.stopInternal();
    clearTimeout(this.sleepTimer);
    this.listeners.clear();
  }

  /** Le n frasi che seguono la posizione data (anche nel capitolo successivo). */
  private upcoming(chapter: number, sentence: number, n: number): string[] {
    const out: string[] = [];
    let c = chapter;
    let s = sentence + 1;
    while (out.length < n && c < this.chapters.length) {
      const list = this.sentences[c];
      if (s < list.length) out.push(list[s++]);
      else {
        c++;
        s = 0;
      }
    }
    return out;
  }

  private stopInternal(): void {
    this.gen++;
    this.deps.engine.stop();
  }

  private clamp(p: Position): Position {
    const chapter = Math.min(Math.max(0, p.chapter), Math.max(0, this.chapters.length - 1));
    const max = Math.max(0, this.sentenceCount(chapter) - 1);
    return { chapter, sentence: Math.min(Math.max(0, p.sentence), max) };
  }

  private set(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }

  private async run(gen: number): Promise<void> {
    while (gen === this.gen) {
      const { chapter, sentence } = this.state.position;
      const list = this.sentences[chapter];
      if (!list) return;
      if (sentence >= list.length) {
        if (chapter + 1 >= this.chapterCount) {
          this.set({ playing: false, buffering: false, finished: true, position: { chapter, sentence: list.length - 1 } });
          return;
        }
        this.set({ position: { chapter: chapter + 1, sentence: 0 } });
        this.deps.onPosition?.(this.state.position);
        if (this.state.sleep === 'chapter') {
          this.set({ playing: false, buffering: false, sleep: null });
          this.gen++;
          return;
        }
        await wait(800);
        continue;
      }
      const opts = this.deps.getOptions();
      // Mostra "caricamento" solo se l'audio tarda a partire (evita sfarfallii tra le frasi)
      const slow = setTimeout(() => {
        if (gen === this.gen && !this.state.buffering) this.set({ buffering: true });
      }, 400);
      try {
        const speaking = this.deps.engine.speak(list[sentence], {
          ...opts,
          onStart: () => {
            clearTimeout(slow);
            if (gen === this.gen && this.state.buffering) this.set({ buffering: false });
          },
        });
        // Prima la frase da leggere ora, poi la preparazione delle successive
        this.deps.engine.prefetch?.(this.upcoming(chapter, sentence, PREFETCH));
        await speaking;
      } catch (e) {
        if (gen !== this.gen) return;
        this.gen++;
        this.set({ playing: false, buffering: false, error: e instanceof Error ? e.message : String(e) });
        return;
      } finally {
        clearTimeout(slow);
      }
      if (gen !== this.gen) return;
      if (this.state.buffering) this.set({ buffering: false });
      if (this.paragraphEnds[chapter]?.has(sentence) && opts.paragraphPause > 0) {
        await wait(opts.paragraphPause / opts.rate);
        if (gen !== this.gen) return;
      }
      this.set({ position: { chapter, sentence: sentence + 1 } });
      if (sentence + 1 < list.length) this.deps.onPosition?.(this.state.position);
    }
  }
}
