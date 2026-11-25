import { getSettings, updateSettings, type Settings } from '../settings';
import type { TtsEngine } from '../tts/engine';
import { h, openDialog } from './dom';

function range(label: string, key: 'rate' | 'pitch' | 'volume' | 'fontSize' | 'paragraphPause', min: number, max: number, step: number, fmt: (v: number) => string, hint?: string) {
  const s = getSettings();
  const out = h('output', {}, fmt(s[key]));
  const input = h('input', { type: 'range', min, max, step, value: s[key], 'aria-label': label });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = fmt(v);
    updateSettings({ [key]: v } as Partial<Settings>);
  });
  return h('div', { class: 'field' }, h('label', {}, label, out), input, hint ? h('div', { class: 'hint' }, hint) : null);
}

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

export async function openSettings(engine: TtsEngine, onPreview?: () => void): Promise<void> {
  const s = getSettings();
  const voices = await engine.getVoices();
  const select = h('select', { 'aria-label': 'Voce' });
  select.append(h('option', { value: '' }, 'Predefinita del sistema'));
  let lastGroup = '';
  let group: HTMLOptGroupElement | null = null;
  for (const v of voices) {
    const g = v.lang.toLowerCase().startsWith('it') ? 'Italiano' : 'Altre lingue';
    if (g !== lastGroup) {
      group = h('optgroup', { label: g });
      select.append(group);
      lastGroup = g;
    }
    group!.append(h('option', { value: v.id, selected: v.id === s.voiceURI }, `${v.name} (${v.lang})${v.quality === 'alta' ? ' ★' : ''}`));
  }
  select.addEventListener('change', () => updateSettings({ voiceURI: select.value || null }));

  const preview = h('button', { class: 'btn secondary', onclick: () => onPreview?.() }, 'Prova la voce');

  const speedChips = h('div', { class: 'chips' });
  const rateField = range('Velocità', 'rate', 0.5, 3, 0.05, (v) => `${v.toFixed(2).replace(/\.?0+$/, '')}×`);
  const rateInput = rateField.querySelector('input')!;
  for (const sp of SPEEDS) {
    speedChips.append(
      h('button', {
        class: 'pill',
        onclick: () => {
          rateInput.value = String(sp);
          rateInput.dispatchEvent(new Event('input'));
        },
      }, `${sp}×`),
    );
  }
  rateField.append(h('div', { style: 'margin-top:10px' }, speedChips));

  const theme = h('select', { 'aria-label': 'Tema' },
    h('option', { value: 'auto', selected: s.theme === 'auto' }, 'Automatico'),
    h('option', { value: 'light', selected: s.theme === 'light' }, 'Chiaro'),
    h('option', { value: 'dark', selected: s.theme === 'dark' }, 'Scuro'),
  );
  theme.addEventListener('change', () => updateSettings({ theme: theme.value as Settings['theme'] }));

  const awake = h('input', { type: 'checkbox', checked: s.keepAwake });
  awake.addEventListener('change', () => updateSettings({ keepAwake: awake.checked }));

  const noVoices = !engine.isSupported()
    ? h('div', { class: 'error-bar' }, 'Questo browser non supporta la sintesi vocale. Prova Chrome, Edge o Safari.')
    : null;

  openDialog(
    'Impostazioni',
    h(
      'div',
      {},
      noVoices,
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'Voce'), select,
        h('div', { class: 'hint' }, '★ = voce di qualità migliore. Su Edge cerca le voci “Natural” (es. Isabella, Diego); su Android installa le voci italiane di Google in Impostazioni › Sintesi vocale.'),
        h('div', { style: 'margin-top:10px' }, preview)),
      rateField,
      range('Tono', 'pitch', 0.5, 2, 0.05, (v) => v.toFixed(2)),
      range('Volume', 'volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
      range('Pausa tra paragrafi', 'paragraphPause', 0, 1500, 50, (v) => `${v} ms`),
      range('Dimensione testo', 'fontSize', 14, 30, 1, (v) => `${v}px`),
      h('div', { class: 'field' }, h('div', { class: 'label' }, 'Tema'), theme),
      h('div', { class: 'field' },
        h('label', { class: 'switch' }, 'Mantieni lo schermo acceso durante la lettura', awake),
        h('div', { class: 'hint' }, 'Sul telefono la voce del browser si ferma quando lo schermo si blocca: questa opzione lo evita.')),
    ),
  );
}
