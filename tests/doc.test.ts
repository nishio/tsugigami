import { describe, expect, it } from 'vitest';
import { Doc, type DocSink } from '../src/doc';
import { bboxOf } from '../src/geom';
import { PAGE_H, type Stroke, newNote, pageTop } from '../src/model';

function setup() {
  const log = { put: [] as string[], del: [] as string[], notes: 0, inval: 0 };
  const sink: DocSink = {
    saveStrokes: (p, d) => { log.put.push(...p.map(s => s.id)); log.del.push(...d); },
    saveNote: () => { log.notes++; },
    invalidate: () => { log.inval++; },
  };
  const note = newNote(0);
  return { doc: new Doc(note, [], sink), log, note };
}

let seq = 0;
const mk = (x: number, y: number, z = ++seq): Stroke => {
  const pts = Float32Array.from([x, y, 0.5, x + 20, y + 5, 0.5]);
  return { id: 's' + seq, noteId: 'n', kind: 'pen', color: '#000', width: 2, pts, b: bboxOf(pts, 3, 2), z };
};

describe('Doc', () => {
  it('追加・取り消し・やり直しが保存先に流れる', () => {
    const { doc, log } = setup();
    const s = mk(10, 10);
    doc.exec({ t: 'add', s: [s] });
    expect(doc.strokes.size).toBe(1);
    expect(log.put).toEqual([s.id]);
    doc.undo();
    expect(doc.strokes.size).toBe(0);
    expect(log.del).toEqual([s.id]);
    doc.redo();
    expect(doc.strokes.size).toBe(1);
  });

  it('空間索引で範囲内の線だけ返す', () => {
    const { doc } = setup();
    const a = mk(10, 10), b = mk(900, 900);
    doc.exec({ t: 'add', s: [a, b] });
    expect(doc.query([0, 0, 100, 100]).map(s => s.id)).toEqual([a.id]);
    expect(doc.query([0, 0, 1000, 1000]).length).toBe(2);
  });

  it('swap は同じ id を削除せずに置き換える', () => {
    const { doc, log } = setup();
    const a = mk(10, 10);
    doc.exec({ t: 'add', s: [a] });
    const moved = { ...a, pts: Float32Array.from([500, 500, 0.5, 520, 505, 0.5]), b: [498, 498, 522, 507] as Stroke['b'] };
    doc.exec({ t: 'swap', before: [a], after: [moved] });
    expect(log.del).toEqual([]);
    expect(doc.query([0, 0, 100, 100]).length).toBe(0);
    expect(doc.query([490, 490, 530, 530]).length).toBe(1);
    doc.undo();
    expect(doc.query([0, 0, 100, 100]).length).toBe(1);
  });

  it('最後のページに書くと白紙のページが足される', () => {
    const { doc, note } = setup();
    expect(note.pages.length).toBe(2);
    doc.exec({ t: 'add', s: [mk(100, pageTop(1) + 50)] });
    expect(note.pages.length).toBe(3);
    doc.exec({ t: 'add', s: [mk(100, pageTop(1) + PAGE_H - 10)] });
    expect(note.pages.length).toBe(3);
  });

  it('ページ幅の変更も取り消せる', () => {
    const { doc, note } = setup();
    const before = note.pages.map(p => ({ ...p }));
    doc.exec({ t: 'pages', before, after: [{ w: 2 }, { w: 1 }] });
    expect(note.pages[0].w).toBe(2);
    doc.undo();
    expect(note.pages[0].w).toBe(1);
  });

  it('消しゴムのように適用済みの変更を記録だけできる', () => {
    const { doc } = setup();
    const a = mk(10, 10);
    doc.exec({ t: 'add', s: [a] });
    doc.apply({ t: 'del', s: [a] });
    doc.record({ t: 'del', s: [a] });
    expect(doc.strokes.size).toBe(0);
    doc.undo();
    expect(doc.strokes.size).toBe(1);
  });
});
