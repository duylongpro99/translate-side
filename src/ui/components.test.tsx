// @vitest-environment jsdom
// Button, IconButton, Select, Segmented, Field, Notice and the icons.
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button.tsx';
import { Field } from './Field.tsx';
import { IconButton } from './IconButton.tsx';
import * as icons from './icons.tsx';
import { Notice } from './Notice.tsx';
import { Segmented } from './Segmented.tsx';
import { Select } from './Select.tsx';

let root: HTMLDivElement;
const draw = (node: preact.ComponentChild) => act(() => render(node, root));
const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel) as T;

beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
});

describe('Button', () => {
  it('is a type=button with its variant class, and passes props through', async () => {
    const click = vi.fn();
    await draw(<Button variant="primary" data-testid="go" onClick={click} disabled={false}>Go</Button>);
    const b = $<HTMLButtonElement>('[data-testid="go"]');
    expect(b.type).toBe('button');
    expect(b.className).toBe('ui-button ui-button--primary');
    b.click();
    expect(click).toHaveBeenCalled();
    await draw(<Button class="extra">Plain</Button>);
    expect($('button').className).toBe('ui-button extra');
  });
});

describe('IconButton', () => {
  it('takes its accessible name and tooltip from label, and shows a pressed state only when given', async () => {
    await draw(<IconButton label="Follow scroll" pressed={true}><icons.FollowIcon /></IconButton>);
    const b = $('button');
    expect(b.getAttribute('aria-label')).toBe('Follow scroll');
    expect(b.getAttribute('title')).toBe('Follow scroll');
    expect(b.getAttribute('aria-pressed')).toBe('true');
    expect($('svg').getAttribute('aria-hidden')).toBe('true');
    await draw(<IconButton label="More"><icons.MoreIcon /></IconButton>);
    expect($('button').hasAttribute('aria-pressed')).toBe(false);
  });
});

describe('Select', () => {
  it('is a native select with every prop passed through, and a hidden chevron', async () => {
    const change = vi.fn();
    await draw(
      <Select quiet data-testid="lang" aria-label="Target language" value="vi" onChange={change}>
        <option value="en">English</option>
        <option value="vi">Vietnamese</option>
      </Select>,
    );
    const s = $<HTMLSelectElement>('select');
    expect(s.dataset.testid).toBe('lang');
    expect(s.getAttribute('aria-label')).toBe('Target language');
    expect(s.value).toBe('vi');
    expect($('.ui-select').classList.contains('ui-select--quiet')).toBe(true);
    expect($('.ui-select svg').getAttribute('aria-hidden')).toBe('true');
    s.value = 'en';
    s.dispatchEvent(new Event('change', { bubbles: true }));
    expect(change).toHaveBeenCalled();
  });
});

describe('Segmented', () => {
  it('is a fieldset of native radios under a legend, checked by value, reporting the chosen one', async () => {
    const change = vi.fn();
    await draw(<Segmented legend="Typeface" name="typeface" value="sans" onChange={change} options={[{ value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Sans' }]} />);
    expect($('fieldset legend').textContent).toBe('Typeface');
    const radios = [...root.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((r) => [r.name, r.value, r.checked])).toEqual([
      ['typeface', 'serif', false],
      ['typeface', 'sans', true],
    ]);
    await act(() => radios[0]?.click());
    expect(change).toHaveBeenCalledWith('serif');
  });
});

describe('Field', () => {
  it('points the label at the control and describes the control with the help text', async () => {
    await draw(<Field label="Name" help="Shown in the panel">{(p) => <input {...p} />}</Field>);
    const input = $<HTMLInputElement>('input');
    expect($<HTMLLabelElement>('label').htmlFor).toBe(input.id);
    expect(document.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Shown in the panel');
    await draw(<Field label="Bare">{(p) => <input {...p} />}</Field>);
    expect($('input').hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('Notice', () => {
  it('is a status for info and an alert for warn and danger', async () => {
    await draw(<Notice>Saved</Notice>);
    expect($('.ui-notice').getAttribute('role')).toBe('status');
    await draw(<Notice tone="warn">Careful</Notice>);
    expect($('.ui-notice').getAttribute('role')).toBe('alert');
    await draw(<Notice tone="danger" data-testid="n">Failed</Notice>);
    expect($('.ui-notice').getAttribute('role')).toBe('alert');
    expect($('.ui-notice').className).toContain('ui-notice--danger');
  });
});

describe('icons', () => {
  it('are 16px stroke SVGs in currentColor, hidden from assistive technology', async () => {
    await draw(<div>{Object.values(icons).map((I, i) => <I key={i} />)}</div>);
    const svgs = [...root.querySelectorAll('svg')];
    expect(svgs).toHaveLength(13);
    for (const s of svgs) {
      expect(s.getAttribute('aria-hidden')).toBe('true');
      expect(s.getAttribute('width')).toBe('16');
      expect(s.getAttribute('stroke')).toBe('currentColor');
    }
  });
});
