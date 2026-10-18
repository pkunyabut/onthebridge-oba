// ─── Pillar → website category code (EXAMPLE mapping used by the OnTheBridge website) ───────────
// The codes are "suggestions" — the editor can change them before publication. Always store the Pillar together with the code
// (Documentary and Questions share D). Never create a new Pillar name from a code. Code F (film) is tied to no Pillar and may be left empty.
// Replace WEB_CODES / DEFAULT_CODE with your own site's categories.

import { PILLARS } from './rules.mjs';

export const WEB_CODES = {
  T: 'Technology & AI', L: 'Legacy & Spirit', D: 'Documentary',
  S: 'Society & Media', E: 'Economy', H: 'Health', F: 'Film & Series'
};

// The default code for each Pillar · Life Skills has none (H/E/S must be chosen by topic every time)
export const DEFAULT_CODE = { 'Human+AI': 'T', Legacy: 'L', Documentary: 'D', Questions: 'D', 'Life Skills': '' };
export const LIFE_SKILLS_CHOICES = ['H', 'E', 'S'];

export function suggestWebCode(pillar) {
  if (!PILLARS.includes(pillar)) return { code: '', needsChoice: false, choices: Object.keys(WEB_CODES) };
  const code = DEFAULT_CODE[pillar];
  return {
    code,
    needsChoice: pillar === 'Life Skills',
    choices: pillar === 'Life Skills' ? LIFE_SKILLS_CHOICES : Object.keys(WEB_CODES),
    note: pillar === 'Human+AI' ? 'For stories that focus on money or society, change it to E or S' : pillar === 'Questions' ? 'Shares code D with Documentary — always store the Pillar together with the code' : ''
  };
}

// Check the editor's choice: the code must be in the table · F is tied to no Pillar, so the Pillar may be empty
export function validateWebCode(code, pillar) {
  if (!Object.hasOwn(WEB_CODES, code)) return 'The category code is not in the table (T/L/D/S/E/H/F)';
  if (code !== 'F' && pillar && !PILLARS.includes(pillar)) return 'Invalid Pillar name';
  return null;
}
