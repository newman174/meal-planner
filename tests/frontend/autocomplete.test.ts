/**
 * @fileoverview Frontend tests for autocomplete behavior
 * Uses jsdom environment to test browser-like code
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';

let dom: JSDOM;
let getCategoryFromFieldKey: (fieldKey: string) => string | null;
let attachAutocomplete: (input: HTMLInputElement, category: string) => void;
type AutocompleteInput = HTMLInputElement & { _autocompleteWrapper: HTMLDivElement };

beforeAll(async () => {
  const appJsPath = path.join(import.meta.dirname, '../../public/app.js');
  const appJsCode = fs.readFileSync(appJsPath, 'utf-8');

  dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
      <body>
        <div id="week-view"></div>
        <span id="week-label"></span>
        <button id="prev-week"></button>
        <button id="next-week"></button>
        <button id="today-btn"></button>
        <button id="history-btn"></button>
        <button id="copy-btn"></button>
        <button id="theme-toggle"><span class="theme-icon"></span></button>
        <button id="inventory-btn"></button>
        <button id="lookahead-btn"></button>
        <div id="lookahead-nav" style="display:none"><div id="lookahead-day-selector"></div></div>
        <span id="app-version"></span>
        <div class="app-layout">
          <aside id="inventory-panel" class="inventory-panel collapsed">
            <button id="inventory-panel-close"></button>
          </aside>
        </div>
        <div id="modal-overlay" class="hidden">
          <span id="modal-title"></span>
          <div id="modal-body"></div>
          <button id="modal-close"></button>
        </div>
      </body>
    </html>
  `, {
    runScripts: 'dangerously',
    url: 'http://localhost:3000'
  });

  // Mock fetch
  (dom.window as typeof globalThis & { fetch: unknown }).fetch = (url: string) => {
    if (url === '/api/suggestions') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          cereal: ['Oatmeal', 'Rice cereal'],
          yogurt: ['Greek yogurt', 'Vanilla yogurt'],
          fruit: ['Apple', 'Banana', 'Blueberries', 'Mango', 'Pear'],
          meat: ['Chicken', 'Turkey'],
          vegetable: ['Broccoli', 'Carrots', 'Peas'],
        })
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ days: [] })
    });
  };

  const script = dom.window.document.createElement('script');
  script.textContent = appJsCode;
  dom.window.document.body.appendChild(script);

  // Call fetchSuggestions (a function declaration = window property) and await it
  // This populates the let-scoped suggestionsCache inside app.js
  const win = dom.window as typeof globalThis & {
    fetchSuggestions: (force?: boolean) => Promise<void>;
    getCategoryFromFieldKey: typeof getCategoryFromFieldKey;
    attachAutocomplete: typeof attachAutocomplete;
  };
  await win.fetchSuggestions(true);

  getCategoryFromFieldKey = win.getCategoryFromFieldKey;
  attachAutocomplete = win.attachAutocomplete;
});

/** Helper: creates an input, attaches autocomplete, adds to DOM */
function createTestInput(id: string, category: string): AutocompleteInput {
  const input = dom.window.document.createElement('input') as AutocompleteInput;
  input.id = id;
  attachAutocomplete(input, category);
  dom.window.document.body.appendChild(input._autocompleteWrapper);
  return input;
}

/** Helper: get dropdown from autocomplete input */
function getDropdown(input: AutocompleteInput): HTMLElement {
  return input._autocompleteWrapper.querySelector('.autocomplete-dropdown') as HTMLElement;
}

/** Helper: get option elements from dropdown */
function getOptions(input: AutocompleteInput): NodeListOf<Element> {
  return input._autocompleteWrapper.querySelectorAll('.autocomplete-option');
}

describe('getCategoryFromFieldKey', () => {
  it('extracts category from baby meal field keys', () => {
    expect(getCategoryFromFieldKey('baby_breakfast_cereal')).toBe('cereal');
    expect(getCategoryFromFieldKey('baby_breakfast_fruit')).toBe('fruit');
    expect(getCategoryFromFieldKey('baby_breakfast_yogurt')).toBe('yogurt');
    expect(getCategoryFromFieldKey('baby_lunch_meat')).toBe('meat');
    expect(getCategoryFromFieldKey('baby_lunch_vegetable')).toBe('vegetable');
    expect(getCategoryFromFieldKey('baby_lunch_fruit')).toBe('fruit');
    expect(getCategoryFromFieldKey('baby_dinner_meat')).toBe('meat');
    expect(getCategoryFromFieldKey('baby_dinner_vegetable')).toBe('vegetable');
    expect(getCategoryFromFieldKey('baby_dinner_fruit')).toBe('fruit');
  });

  it('returns null for non-baby fields', () => {
    expect(getCategoryFromFieldKey('adult_dinner')).toBeNull();
    expect(getCategoryFromFieldKey('note')).toBeNull();
  });
});

describe('attachAutocomplete', () => {
  it('wraps input in autocomplete-wrapper div', () => {
    const input = createTestInput('test-wrap', 'fruit');
    expect(input._autocompleteWrapper).toBeTruthy();
    expect(input._autocompleteWrapper.className).toBe('autocomplete-wrapper');
    expect(input._autocompleteWrapper.contains(input)).toBe(true);
  });

  it('creates a dropdown with listbox role', () => {
    const input = createTestInput('test-listbox', 'fruit');
    const dropdown = getDropdown(input);
    expect(dropdown).toBeTruthy();
    expect(dropdown.getAttribute('role')).toBe('listbox');
  });

  it('sets combobox ARIA role on input', () => {
    const input = createTestInput('test-aria', 'meat');
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
  });

  it('shows suggestions on focus', () => {
    const input = createTestInput('test-focus', 'vegetable');
    input.focus();

    const dropdown = getDropdown(input);
    expect(dropdown.style.display).not.toBe('none');

    const options = getOptions(input);
    expect(options.length).toBe(3); // Broccoli, Carrots, Peas
    expect(options[0].textContent).toBe('Broccoli');
    expect(options[1].textContent).toBe('Carrots');
    expect(options[2].textContent).toBe('Peas');
  });

  it('filters suggestions by typed text', () => {
    const input = createTestInput('test-filter', 'fruit');
    input.value = 'an';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    const options = getOptions(input);
    // "Banana" and "Mango" contain "an"
    expect(options.length).toBe(2);
    expect(options[0].textContent).toBe('Banana');
    expect(options[1].textContent).toBe('Mango');
  });

  it('hides dropdown when no matches', () => {
    const input = createTestInput('test-nomatch', 'fruit');
    input.value = 'zzz';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

    const dropdown = getDropdown(input);
    expect(dropdown.style.display).toBe('none');
  });

  it('closes dropdown on Escape key', () => {
    const input = createTestInput('test-escape', 'cereal');

    // Open dropdown
    input.focus();
    const dropdown = getDropdown(input);
    expect(dropdown.style.display).not.toBe('none');

    // Press Escape
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dropdown.style.display).toBe('none');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('navigates options with ArrowDown and ArrowUp', () => {
    const input = createTestInput('test-arrows', 'meat');
    input.focus();

    // ArrowDown to first option
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
    const options = getOptions(input);
    expect(options[0].classList.contains('highlighted')).toBe(true);
    expect(input.getAttribute('aria-activedescendant')).toBe('test-arrows-opt-0');

    // ArrowDown to second option
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(options[1].classList.contains('highlighted')).toBe(true);
    expect(options[0].classList.contains('highlighted')).toBe(false);

    // ArrowUp back to first option
    input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(options[0].classList.contains('highlighted')).toBe(true);
  });
});
