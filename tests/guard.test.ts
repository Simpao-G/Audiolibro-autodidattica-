import { beforeEach, describe, expect, it } from 'vitest';
import { clearHdCrash, clearHdLoading, detectHdCrash, hdCrashedHere, markHdLoading } from '../src/tts/guard';
import { SHARED_KEYS } from '../src/settings';

describe('Guardia anti-crash della voce HD', () => {
  beforeEach(() => localStorage.clear());

  it('caricamento finito normalmente: nessun crash rilevato', () => {
    markHdLoading();
    clearHdLoading();
    expect(detectHdCrash()).toBe(false);
    expect(hdCrashedHere()).toBe(false);
  });

  it('pagina chiusa durante il caricamento: crash rilevato al riavvio, una sola volta', () => {
    markHdLoading();
    expect(detectHdCrash()).toBe(true);
    expect(hdCrashedHere()).toBe(true);
    expect(detectHdCrash()).toBe(false);
  });

  it('"riprova comunque" toglie il blocco', () => {
    markHdLoading();
    detectHdCrash();
    clearHdCrash();
    expect(hdCrashedHere()).toBe(false);
  });
});

describe('Impostazioni sincronizzate', () => {
  it('il motore vocale resta per dispositivo (i modelli si scaricano per dispositivo)', () => {
    expect(SHARED_KEYS as readonly string[]).not.toContain('engine');
    expect(SHARED_KEYS as readonly string[]).toContain('rate');
  });
});
