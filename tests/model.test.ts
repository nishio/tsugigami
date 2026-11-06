import { describe, expect, it } from 'vitest';
import { newNote } from '../src/model';

describe('newNote', () => {
  it('題名は「ノート(作った日~)」(1 日分のノートに見える「~のノート」にしない)', () => {
    const n = newNote(new Date(2026, 10, 3, 9, 5).getTime());
    expect(n.title).toBe('ノート(2026-11-03~)');
    expect(n.created).toBe(new Date(2026, 10, 3, 9, 5).getTime());
  });
});
