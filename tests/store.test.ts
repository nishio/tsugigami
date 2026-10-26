import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { bboxOf } from '../src/geom';
import { type Stroke, newNote } from '../src/model';
import { Store } from '../src/store';

const mk = (id: string, noteId: string): Stroke => {
  const pts = Float32Array.from([1.25, 2.5, 0.5, 30, 40, 0.75]);
  return { id, noteId, kind: 'pen', color: '#000', width: 2, pts, b: bboxOf(pts, 3, 2), z: 1 };
};

describe('Store', () => {
  it('ストロークを差分で保存して読み戻せる', async () => {
    const st = await Store.open('t1');
    const n = newNote(1);
    await st.putNote(n);
    await st.saveStrokes([mk('a', n.id), mk('b', n.id)], []);
    await st.saveStrokes([], ['a']);
    const got = await st.strokesOf(n.id);
    expect(got.map(s => s.id)).toEqual(['b']);
    expect(got[0].pts).toBeInstanceOf(Float32Array);
    expect(got[0].pts[0]).toBeCloseTo(1.25);
    st.close();
  });

  it('書き出したものを別の保存領域に読み込める', async () => {
    const a = await Store.open('t2');
    const n = newNote(1);
    await a.putNote(n);
    await a.saveStrokes([mk('x', n.id)], []);
    const backup = JSON.parse(JSON.stringify(await a.exportAll()));
    const b = await Store.open('t3');
    expect(await b.importAll(backup)).toBe(1);
    expect((await b.strokesOf(n.id))[0].pts[3]).toBeCloseTo(30);
    // 同じ内容をもう一度読み込んでも増えない
    expect(await b.importAll(backup)).toBe(0);
    a.close(); b.close();
  });

  it('手元のほうが新しければ読み込みで上書きしない', async () => {
    const a = await Store.open('t4');
    const n = newNote(1);
    await a.putNote(n);
    const backup = await a.exportAll();
    await a.putNote({ ...n, title: '新しい名前', updated: 999 });
    expect(await a.importAll(backup)).toBe(0);
    expect((await a.getNote(n.id))!.title).toBe('新しい名前');
    a.close();
  });

  it('ノートを完全に消すとストロークも消える', async () => {
    const a = await Store.open('t5');
    const n = newNote(1);
    await a.putNote(n);
    await a.saveStrokes([mk('p', n.id)], []);
    await a.deleteNote(n.id);
    expect(await a.getNote(n.id)).toBeUndefined();
    expect(await a.strokesOf(n.id)).toEqual([]);
    a.close();
  });

  it('形式の違うファイルは拒否する', async () => {
    const a = await Store.open('t6');
    await expect(a.importAll({ foo: 1 } as never)).rejects.toThrow();
    a.close();
  });
});
