/**
 * Tests für renderFieldsEditor + serializeFieldsInput (Etappe B.7, A4).
 *
 * Renderer lebt in spielplan-helpers.js, damit er ohne DOM-Mock
 * getestet werden kann. main.js ruft ihn via
 * `window.spielplanHelpers.renderFieldsEditor(...)` auf.
 *
 * Was wir hier prüfen:
 *   - renderFieldsEditor: Default-Namen, Count-Spinbutton, Lock-Hinweis
 *   - serializeFieldsInput: Validierung
 */

import { describe, it, expect } from 'vitest';
import { renderFieldsEditor } from '../spielplan-helpers.js';

describe('renderFieldsEditor', () => {
  it('Default: 4 Felder mit "Platte 1"…"Platte 4" wenn fields = []', () => {
    const html = renderFieldsEditor([], { isAdmin: true });
    expect(html).toContain('data-fields-count="4"');
    expect(html).toContain('value="Platte 1"');
    expect(html).toContain('value="Platte 4"');
    expect(html).not.toContain('value="Platte 5"');
  });

  it('Default: 4 Felder wenn fields = null', () => {
    const html = renderFieldsEditor(null, { isAdmin: true });
    expect(html).toContain('data-fields-count="4"');
  });

  it('Custom-Felder werden in order-Reihenfolge gerendert', () => {
    const fields = [
      { id: 'f1', name: 'Tischtennisplatte A', order: 0 },
      { id: 'f2', name: 'Platte 2', order: 1 },
    ];
    const html = renderFieldsEditor(fields, { isAdmin: true });
    expect(html).toContain('value="Tischtennisplatte A"');
    expect(html).toContain('value="Platte 2"');
    expect(html).toContain('data-fields-count="2"');
  });

  it('locked=true: alle Inputs disabled, Lock-Hinweis sichtbar', () => {
    const html = renderFieldsEditor([{ id: 'f1', name: 'Platte 1', order: 0 }], {
      locked: true,
      isAdmin: true,
    });
    expect(html).toContain('disabled');
    expect(html).toContain('t-fields-locked-hint');
    expect(html).toContain('Spielfelder sind nach der Generierung gesperrt');
    // Kein Save-Button
    expect(html).not.toContain('data-action="save-fields"');
  });

  it('isAdmin=false: keine Action-Buttons, Inputs disabled', () => {
    const html = renderFieldsEditor([{ id: 'f1', name: 'Platte 1', order: 0 }], {
      isAdmin: false,
      locked: false,
    });
    expect(html).toContain('disabled');
    expect(html).not.toContain('data-action="save-fields"');
  });

  it('isAdmin=true + nicht locked: Save + Cancel-Button sichtbar', () => {
    const html = renderFieldsEditor([{ id: 'f1', name: 'Platte 1', order: 0 }], {
      isAdmin: true,
      locked: false,
    });
    expect(html).toContain('data-action="save-fields"');
    expect(html).toContain('data-action="reset-fields"');
  });

  it('Count-Input hat min=1 max=12', () => {
    const html = renderFieldsEditor([], { isAdmin: true });
    expect(html).toContain('min="1"');
    expect(html).toContain('max="12"');
  });

  it('XSS: Name mit <script> wird escaped', () => {
    const fields = [{ id: 'f1', name: '<script>alert(1)</script>', order: 0 }];
    const html = renderFieldsEditor(fields, { isAdmin: true });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('Jede Row hat data-field-idx und t-field-order-Label #1..#N', () => {
    const fields = [
      { id: 'f1', name: 'A', order: 0 },
      { id: 'f2', name: 'B', order: 1 },
      { id: 'f3', name: 'C', order: 2 },
    ];
    const html = renderFieldsEditor(fields, { isAdmin: true });
    expect(html).toContain('data-field-idx="0"');
    expect(html).toContain('data-field-idx="2"');
    expect(html).toContain('#1');
    expect(html).toContain('#3');
  });
});
