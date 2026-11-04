import { describe, expect, it } from 'vitest';
import type { Nation } from '../core/types';
import { BRIEFING_LANG, imperialNation } from './nations';

const NATIONS: Nation[] = ['germany', 'france', 'britain', 'usa'];

describe('nation presentation rules', () => {
  it('writes German and French briefings in their own language, the rest in English', () => {
    expect(BRIEFING_LANG).toEqual({ germany: 'de', france: 'fr', britain: 'en', usa: 'en' });
  });

  it('gives British and American airmen imperial units', () => {
    expect(NATIONS.filter(imperialNation)).toEqual(['britain', 'usa']);
  });
});
