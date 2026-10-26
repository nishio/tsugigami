// 起動と画面の部品(道具バー、ノート一覧、選択メニュー、紙の継ぎ足しボタン)。
import './style.css';
import { AutoBackup } from './autobackup';
import { Controller } from './controller';
import { Doc, type DocSink } from './doc';
import { type Note, PAGE_W, newNote, noteBounds, pageIndexAt, pageRect } from './model';
import { Renderer } from './render';
import { type Backup, Store } from './store';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

// 色と太さは Notability での nishio の設定に合わせた(issue #1 のスクリーンショットから採った値)
const PEN_COLORS: [string, string][] = [['#000000', '黒'], ['#da4733', '赤'], ['#2f6df6', '青'], ['#77b856', '緑'], ['#eda139', '橙']];
const MARKER_COLORS: [string, string][] = [
  ['#edaea6', '赤'], ['#9ec2fa', '青'], ['#c3e1b5', '緑'], ['#f7d79d', '黄'], ['#d3d3d3', '薄い灰'], ['#949494', '濃い灰'],
];
const PEN_WIDTHS = [1, 2.2, 4.4];
const MARKER_WIDTHS = [2.2, 11, 35];
const BACKUP_WARN_DAYS = 7;

interface SavedView { cx: number; top: number; s: number }

let toastTimer = 0;
function toast(msg: string, error = false): void {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), error ? 8000 : 2500);
}

const fmtDate = (t: number) => {
  const d = new Date(t), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

async function main(): Promise<void> {
  let store: Store;
  try { store = await Store.open(); } catch (e) { toast('保存領域を開けませんでした: ' + String(e), true); return; }

  const stage = $('#stage');
  const r = new Renderer(stage);
  const c = new Controller(stage, r);
  let doc: Doc | null = null;

  const fail = (e: unknown) => {
    console.error(e);
    toast('保存に失敗しました。ノート一覧から書き出してバックアップを取ってください: ' + ((e as Error)?.message ?? String(e)), true);
  };
  // ---- GitHub への自動バックアップ ----
  const auto = new AutoBackup(store, {
    listNotes: () => store.listNotes(),
    strokesOf: id => (doc?.note.id === id ? Promise.resolve([...doc.strokes.values()]) : store.strokesOf(id)),
  }, () => c.busy);
  store.onChange = () => auto.changed();
  auto.onStatus = () => { renderGh(); updateBadge(); };
  await auto.load();

  // 書き込みは Store が成功するまで再試行する(失敗で捨てない)。失敗している間は消えない警告を出す
  const sink: DocSink = {
    saveStrokes: (put, del) => { store.saveStrokes(put, del).catch(fail); },
    saveNote: n => { store.putNote(n).catch(fail); },
    invalidate: b => r.invalidate(b),
  };
  let saveWasBad = false;
  store.onStatus = s => {
    const bad = !!s.error && s.pending > 0, el = $('#saveWarn');
    el.hidden = !bad;
    if (bad) el.textContent = `この iPad への保存に失敗しています(${s.pending} 件待ち)。自動でやり直しています。アプリを閉じないでください。`;
    else if (saveWasBad) toast('保存できました');
    saveWasBad = bad;
    updateBadge();
  };


  // ---- 表示位置の保存 ----
  let viewTimer = 0;
  const flushView = () => {
    clearTimeout(viewTimer);
    if (!doc) return;
    const v = r.view, [cx, top] = r.toWorld(r.W / 2, 0);
    store.setMeta('view:' + doc.note.id, { cx, top, s: v.s } satisfies SavedView).catch(() => {});
  };

  // ---- ノートを開く ----
  async function openNote(id: string): Promise<void> {
    c.reset(); // 書きかけがあれば元のノートに確定させてから切り替える
    c.clearSelection();
    flushView();
    const note = await store.getNote(id);
    if (!note) return;
    doc = new Doc(note, await store.strokesOf(id), sink);
    r.setDoc(doc);
    const v = await store.getMeta<SavedView>('view:' + id);
    if (v) {
      r.view.s = v.s; r.view.x = r.W / 2 - v.cx * v.s; r.view.y = -v.top * v.s;
      r.clampView(); r.settle();
    } else r.fitView();
    await store.setMeta('lastNote', id);
    renderTitle();
    syncTools();
  }

  async function createNote(): Promise<void> {
    const note = newNote();
    await store.putNote(note);
    await openNote(note.id);
  }

  // ---- 道具バー ----
  function renderTitle(): void { $('#title').textContent = doc?.note.title ?? ''; }

  function syncTools(): void {
    const tool = c.tool;
    document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
    const kind = tool === 'marker' ? 'marker' : 'pen';
    const brush = kind === 'pen' ? c.pen : c.marker;
    const sw = $('#swatches');
    sw.innerHTML = '';
    for (const [color, name] of kind === 'pen' ? PEN_COLORS : MARKER_COLORS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sw' + (kind === 'marker' ? ' marker' : '');
      b.setAttribute('aria-label', name);
      b.setAttribute('aria-pressed', String(brush.color === color && (tool === kind || !!c.sel)));
      b.innerHTML = `<i style="--c:${color}"></i>`;
      b.onclick = () => { c.setColor(kind, color); syncTools(); };
      sw.append(b);
    }
    const wd = $('#widths');
    wd.innerHTML = '';
    wd.hidden = tool === 'eraser' || tool === 'lasso';
    (kind === 'pen' ? PEN_WIDTHS : MARKER_WIDTHS).forEach((w, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'wd';
      b.setAttribute('aria-label', ['細', '中', '太'][i]);
      b.setAttribute('aria-pressed', String(brush.width === w));
      const px = [4, 7, 11][i];
      b.innerHTML = `<i style="width:${px}px;height:${px}px"></i>`;
      b.onclick = () => { brush.width = w; c.setTool(kind); syncTools(); };
      wd.append(b);
    });
    ($('#undo') as HTMLButtonElement).disabled = !doc?.undoStack.length;
    ($('#redo') as HTMLButtonElement).disabled = !doc?.redoStack.length;
    $('#paste').hidden = !c.clipboard.length;
    $('#paper').setAttribute('aria-pressed', String(doc?.note.paper === 'grid'));
  }

  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach(b => {
    b.onclick = () => { c.setTool(b.dataset.tool as typeof c.tool); syncTools(); };
  });
  $('#undo').onclick = () => c.undo();
  $('#redo').onclick = () => c.redo();
  $('#paste').onclick = () => c.paste();
  $('#paper').onclick = () => {
    if (!doc) return;
    doc.note.paper = doc.note.paper === 'grid' ? 'plain' : 'grid';
    store.putNote(doc.note).catch(fail);
    r.invalidate(null);
    syncTools();
  };
  c.onState = syncTools;

  // 名前の変更
  const titleInput = $('#titleInput') as HTMLInputElement;
  $('#title').onclick = () => {
    if (!doc) return;
    titleInput.value = doc.note.title;
    $('#title').hidden = true; titleInput.hidden = false;
    titleInput.focus(); titleInput.select();
  };
  const commitTitle = () => {
    if (titleInput.hidden) return;
    titleInput.hidden = true; $('#title').hidden = false;
    const v = titleInput.value.trim();
    if (doc && v && v !== doc.note.title) {
      doc.note.title = v; doc.note.updated = Date.now();
      store.putNote(doc.note).catch(fail);
    }
    renderTitle();
  };
  titleInput.addEventListener('blur', commitTitle);
  titleInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing) commitTitle();
    if (e.key === 'Escape') { titleInput.value = doc?.note.title ?? ''; commitTitle(); }
  });

  // ---- 選択メニュー ----
  const menu = $('#selMenu');
  const stageTop = () => stage.getBoundingClientRect().top;
  c.onSelectionBox = box => {
    if (!box) { menu.hidden = true; return; }
    menu.hidden = false;
    const mw = menu.offsetWidth, mh = menu.offsetHeight, top0 = stageTop();
    let y = top0 + box[1] - mh - 50;
    if (y < top0 + 6) y = top0 + box[3] + 16;
    y = Math.min(y, window.innerHeight - mh - 10);
    const x = Math.max(8, Math.min(window.innerWidth - mw - 8, (box[0] + box[2]) / 2 - mw / 2));
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
  };
  menu.addEventListener('click', e => {
    const act = (e.target as HTMLElement).closest('button')?.dataset.act;
    if (act === 'copy') { c.copy(); toast('コピーしました'); }
    else if (act === 'cut') c.cut();
    else if (act === 'duplicate') c.duplicate();
    else if (act === 'delete') c.deleteSelection();
  });

  // ---- 紙を右へ継ぎ足すボタン ----
  const pageLayer = $('#pageButtons');
  const pool: HTMLButtonElement[] = [];
  const pageButton = (i: number): HTMLButtonElement => {
    let b = pool[i];
    if (!b) {
      b = pool[i] = document.createElement('button');
      b.type = 'button'; b.className = 'page-btn';
      pageLayer.append(b);
    }
    return b;
  };
  const resizePage = (i: number, dw: number) => {
    if (!doc) return;
    const before = doc.note.pages.map(p => ({ ...p }));
    const after = before.map((p, k) => (k === i ? { w: p.w + dw } : { ...p }));
    c.clearSelection();
    // 外す前に、選択の変形を確定させたうえで白紙か確かめ直す
    if (dw < 0) {
      const pr = pageRect(doc.note, i);
      if (doc.query([PAGE_W * (before[i].w - 1), pr[1], pr[2], pr[3]]).length) { r.request(); return; }
    }
    doc.exec({ t: 'pages', before, after });
    r.clampView();
    r.request();
    syncTools();
  };
  r.onViewChange = () => {
    clearTimeout(viewTimer);
    viewTimer = window.setTimeout(flushView, 500);
    let n = 0;
    if (doc) {
      for (let i = 0; i < doc.note.pages.length; i++) {
        const pr = pageRect(doc.note, i);
        const [x1, y0] = r.toScreen(pr[2], pr[1]), [, y1] = r.toScreen(pr[2], pr[3]);
        if (y1 < 0 || y0 > r.H || x1 > r.W + 4 || x1 < -30) continue;
        const cy = (Math.max(0, y0) + Math.min(r.H, y1)) / 2;
        const w = doc.note.pages[i].w;
        const plus = pageButton(n++);
        plus.textContent = '+'; plus.setAttribute('aria-label', `${i + 1} ページ目を右に広げる`);
        plus.style.transform = `translate(${x1 + 2}px, ${cy - 56}px)`;
        plus.hidden = false;
        plus.onclick = () => resizePage(i, 1);
        // 継ぎ足した一番右の紙が白紙なら、取り除ける
        if (w > 1 && !doc.query([PAGE_W * (w - 1), pr[1], pr[2], pr[3]]).length) {
          const minus = pageButton(n++);
          minus.textContent = '−'; minus.setAttribute('aria-label', `${i + 1} ページ目の右の紙を外す`);
          minus.style.transform = `translate(${x1 + 2}px, ${cy + 4}px)`;
          minus.hidden = false;
          minus.onclick = () => resizePage(i, -1);
        }
      }
    }
    for (let k = n; k < pool.length; k++) pool[k].hidden = true;
    placeScroller();
  };

  // ---- 右端のスクロールつまみ(長いノートを素早く行き来する) ----
  const scroller = $('#scroller'), pageLabel = $('#pageLabel');
  const noteSpan = () => {
    const nb = noteBounds(doc!.note), v = r.view;
    return { top: nb[1] * v.s, h: (nb[3] - nb[1]) * v.s + 80 };
  };
  function placeScroller(): void {
    if (!doc) { scroller.hidden = true; return; }
    const { h } = noteSpan(), v = r.view;
    if (h <= r.H * 1.2) { scroller.hidden = true; return; }
    scroller.hidden = false;
    const th = Math.max(44, (r.H * r.H) / h), pos = Math.min(1, Math.max(0, (40 - v.y) / (h - r.H)));
    scroller.style.height = th + 'px';
    scroller.style.top = (pos * (r.H - th)) + 'px';
  }
  let drag: { id: number; y0: number; v0: number } | null = null;
  scroller.addEventListener('pointerdown', e => {
    e.stopPropagation();
    try { scroller.setPointerCapture(e.pointerId); } catch { /* 合成イベントなど */ }
    drag = { id: e.pointerId, y0: e.clientY, v0: r.view.y };
    scroller.classList.add('active');
  });
  scroller.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id || !doc) return;
    const { h } = noteSpan(), th = Math.max(44, (r.H * r.H) / h);
    r.view.y = drag.v0 - ((e.clientY - drag.y0) * (h - r.H)) / (r.H - th);
    r.clampView();
    r.request();
    const [, y] = r.toWorld(0, r.H / 2);
    pageLabel.textContent = `${pageIndexAt(doc.note, y) + 1} / ${doc.note.pages.length} ページ`;
    pageLabel.hidden = false;
  });
  const endDrag = () => { drag = null; scroller.classList.remove('active'); pageLabel.hidden = true; r.settle(); };
  scroller.addEventListener('pointerup', endDrag);
  scroller.addEventListener('pointercancel', endDrag);

  // ---- ノート一覧 ----
  const drawer = $('#drawer'), scrim = $('#scrim');
  const openDrawer = async () => { c.clearSelection(); await renderDrawer(); drawer.hidden = scrim.hidden = false; };
  const closeDrawer = () => { drawer.hidden = scrim.hidden = true; };
  $('#menuBtn').onclick = openDrawer;
  scrim.onclick = closeDrawer;
  $('#newNote').onclick = async () => { await createNote(); closeDrawer(); };

  async function renderDrawer(): Promise<void> {
    const notes = await store.listNotes();
    const live = notes.filter(n => !n.trashed).sort((a, b) => b.updated - a.updated);
    const trashed = notes.filter(n => n.trashed).sort((a, b) => b.trashed! - a.trashed!);
    const list = $('#noteList');
    list.innerHTML = '';
    for (const n of live) list.append(noteItem(n, false));
    const tl = $('#trashList');
    tl.innerHTML = '';
    for (const n of trashed) tl.append(noteItem(n, true));
    $('#trashCount').textContent = trashed.length ? `(${trashed.length})` : '';
    $('#trash').hidden = !trashed.length;

    const last = await store.getMeta<number>('lastBackup');
    $('#backupInfo').textContent = last ? `最後に書き出したのは ${fmtDate(last)}` : 'まだ一度も書き出していません';
    renderGh();
    ($('#ghRepo') as HTMLInputElement).value = auto.cfg?.repo ?? '';
    const tok = $('#ghToken') as HTMLInputElement;
    tok.value = '';
    tok.placeholder = auto.cfg ? '保存済み(変えるときだけ貼る)' : 'github_pat_…';
    ($('#ghSetup') as HTMLDetailsElement).open = !auto.cfg;

    const persisted = await navigator.storage?.persisted?.().catch(() => false);
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    $('#storageInfo').textContent =
      `${persisted ? '消されにくい保存領域を使っています' : 'ブラウザの判断で消される可能性がある保存領域です'}` +
      (est?.usage != null ? `(使用量 ${(est.usage / 1048576).toFixed(1)} MB)` : '');
    renderStats();
  }

  function noteItem(n: Note, inTrash: boolean): HTMLLIElement {
    const li = document.createElement('li');
    if (n.id === doc?.note.id) li.className = 'current';
    const open = document.createElement('button');
    open.type = 'button'; open.className = 'open';
    open.innerHTML = '<b></b><small></small>';
    open.querySelector('b')!.textContent = n.title;
    open.querySelector('small')!.textContent = (inTrash ? '削除 ' + fmtDate(n.trashed!) : fmtDate(n.updated));
    li.append(open);
    const act = (label: string, f: () => void) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'act'; b.textContent = label; b.onclick = f;
      li.append(b);
      return b;
    };
    if (!inTrash) {
      open.onclick = async () => { await openNote(n.id); closeDrawer(); };
      act('ゴミ箱へ', async () => {
        n.trashed = Date.now();
        if (doc?.note.id === n.id) doc.note.trashed = n.trashed;
        await store.putNote(n);
        if (doc?.note.id === n.id) {
          const rest = (await store.listNotes()).filter(x => !x.trashed).sort((a, b) => b.updated - a.updated);
          if (rest.length) await openNote(rest[0].id); else await createNote();
        }
        await renderDrawer();
      });
    } else {
      open.disabled = true;
      act('戻す', async () => { delete n.trashed; await store.putNote(n); await renderDrawer(); });
      const del = act('完全に削除', async () => {
        if (!del.classList.contains('confirm')) {
          del.classList.add('confirm'); del.textContent = 'もう一度押すと削除';
          setTimeout(() => { del.classList.remove('confirm'); del.textContent = '完全に削除'; }, 3000);
          return;
        }
        await store.deleteNote(n.id);
        await auto.noteDeleted(n.id);
        await renderDrawer();
      });
    }
    return li;
  }

  function renderStats(): void {
    const s = c.stats, ok = (b: boolean) => (b ? 'あり' : 'なし');
    const rows: [string, string][] = [
      ['入力', s.lastType],
      ['筆圧(直近)', s.pressure.toFixed(2)],
      ['move イベント', s.evRate ? `${Math.round(s.evRate)} 回/秒` : '—'],
      ['取得した点', s.ptRate ? `${Math.round(s.ptRate)} 点/秒` : '—'],
      ['JS に届くまで', s.lagMs ? `${s.lagMs.toFixed(1)} ms` : '—'],
      ['合体イベント', ok(s.coalesced)],
      ['予測イベント', ok(s.predicted)],
      ['低遅延キャンバス', ok(r.lowLatency)],
      ['ペンのホバー', ok(s.hover)],
      ['手のひらとして無視', String(s.palm)],
      ['画素比', String(r.dpr)],
    ];
    const dl = $('#stats');
    dl.innerHTML = '';
    for (const [k, v] of rows) { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = k; dd.textContent = v; dl.append(dt, dd); }
  }

  // ---- バックアップ ----
  function renderGh(): void {
    const s = auto.status, info = $('#ghInfo');
    info.classList.toggle('error', !!s.error);
    $('#ghActions').hidden = !s.configured;
    if (!s.configured) {
      info.textContent = '設定されていません。設定すると、書いた内容が少し手を止めるたびに GitHub の repo へ commit されます(履歴が残るので、どの時点にも戻せます)。';
      return;
    }
    const parts = [`${auto.cfg!.repo} へ送ります`, s.lastOk ? `最後に送ったのは ${fmtDate(s.lastOk)}` : 'まだ送っていません'];
    if (s.running) parts.push('送っています…');
    else if (s.dirty) parts.push('まだ送っていない変更があります');
    if (s.error) parts.push('失敗: ' + s.error);
    info.textContent = parts.join('。');
  }

  $('#ghSave').onclick = async () => {
    const repo = ($('#ghRepo') as HTMLInputElement).value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '');
    const token = ($('#ghToken') as HTMLInputElement).value.trim() || auto.cfg?.token || '';
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { toast('repo は owner/name の形で書いてください', true); return; }
    if (!token) { toast('トークンを貼ってください', true); return; }
    try {
      await auto.configure({ repo, token });
      toast(auto.status.error ? '設定しましたが、送れませんでした: ' + auto.status.error : 'GitHub へ送りました', !!auto.status.error);
      await renderDrawer();
    } catch (e) {
      toast('つながりませんでした: ' + ((e as Error)?.message ?? String(e)), true);
    }
  };
  $('#ghClear').onclick = async () => { await auto.configure(null); await renderDrawer(); toast('GitHub の設定を消しました(repo の中身はそのままです)'); };
  $('#ghNow').onclick = async () => {
    await auto.run();
    toast(auto.status.error ? '送れませんでした: ' + auto.status.error : 'GitHub へ送りました', !!auto.status.error);
  };
  $('#ghRestore').onclick = async () => {
    try {
      const n = await auto.restore();
      toast(n ? `${n} 冊のノートを GitHub から読み込みました` : 'GitHub に手元より新しい内容はありませんでした');
      if (doc) await openNote(doc.note.id);
      await renderDrawer();
    } catch (e) {
      toast('読み込めませんでした: ' + ((e as Error)?.message ?? String(e)), true);
    }
  };

  $('#exportBtn').onclick = async () => {
    try {
      const data = await store.exportAll();
      // 開いているノートは画面の内容が正しい(保存待ちの線があっても書き出しから漏らさない)
      if (doc) {
        const d = doc;
        data.notes = data.notes.filter(n => n.id !== d.note.id).concat(structuredClone(d.note));
        data.strokes = data.strokes.filter(s => s.noteId !== d.note.id)
          .concat([...d.strokes.values()].map(s => ({ ...s, pts: Array.from(s.pts, v => Math.round(v * 1000) / 1000) })));
      }
      const d = new Date(), p = (n: number) => String(n).padStart(2, '0');
      const name = `tsugigami-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
      const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
      const download = () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file); a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      };
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: name });
        } catch (e) {
          // 書き出しの準備に時間がかかると、共有シートを開く許可(ユーザー操作の直後であること)が切れて
          // NotAllowedError になる。そのときは通常のダウンロードで出す
          if ((e as Error)?.name === 'AbortError') throw e;
          download();
        }
      } else download();
      await store.setMeta('lastBackup', Date.now());
      updateBadge();
      await renderDrawer();
      toast('書き出しました');
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') toast('書き出せませんでした: ' + String(e), true);
    }
  };
  ($('#importFile') as HTMLInputElement).onchange = async e => {
    const input = e.target as HTMLInputElement, f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      const n = await store.importAll(JSON.parse(await f.text()) as Backup);
      toast(n ? `${n} 冊のノートを読み込みました` : '新しい内容はありませんでした');
      if (doc) await openNote(doc.note.id);
      await renderDrawer();
    } catch (err) {
      toast('読み込めませんでした: ' + ((err as Error)?.message ?? String(err)), true);
    }
  };

  /**
   * メニューの赤い点: 書いたものが守られていないかもしれないとき。
   * 手元への保存に失敗している / GitHub を設定していて送れていない / 設定していなくて 7 日書き出していない
   */
  async function updateBadge(): Promise<void> {
    const g = auto.status;
    let warn = !!store.status.error;
    if (g.configured) warn ||= !!g.error && g.dirty;
    else {
      const last = await store.getMeta<number>('lastBackup');
      warn ||= (!last || Date.now() - last > BACKUP_WARN_DAYS * 86400000) && (doc?.strokes.size ?? 0) > 0;
    }
    ($('#menuBtn .badge') as HTMLElement).hidden = !warn;
  }

  // ---- 永続化の申請(初めて書いたとき) ----
  let asked = false;
  c.onInk = () => {
    if (asked) return;
    asked = true;
    navigator.storage?.persist?.().catch(() => {});
    updateBadge();
  };

  // ---- キーボード(外付けキーボード用) ----
  document.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return;
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) c.redo(); else c.undo(); }
    else if (mod && k === 'c') c.copy();
    else if (mod && k === 'x') c.cut();
    else if (mod && k === 'v') c.paste();
    else if ((k === 'backspace' || k === 'delete') && c.sel) c.deleteSelection();
    else if (k === 'escape') c.clearSelection();
  });

  // ページ自体のピンチズームを止める
  for (const n of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(n, e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());
  // 裏に回るとき、指やペンの離すイベントが届かないことがあるので状態を捨てる
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { c.reset(); flushView(); auto.soon(); } });
  window.addEventListener('online', () => auto.soon());
  window.addEventListener('blur', () => c.reset());

  const onResize = () => { r.resize(); c.updateRect(); };
  new ResizeObserver(onResize).observe(stage);
  onResize();

  // ---- 起動 ----
  $('#version').textContent = `tsugigami ${__BUILD__}`;
  const lastId = await store.getMeta<string>('lastNote');
  const notes = await store.listNotes();
  const first = notes.find(n => n.id === lastId && !n.trashed) ?? notes.filter(n => !n.trashed).sort((a, b) => b.updated - a.updated)[0];
  if (first) await openNote(first.id); else await createNote();
  updateBadge();
  navigator.storage?.persist?.().catch(() => {});
  auto.run().catch(() => {}); // 前回送れなかった分があれば送る(変わっていなければ読むだけ)

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(e => console.warn('service worker', e));
  }
  // テストから状態を覗くための口
  (window as unknown as { tsugigami: unknown }).tsugigami = { get doc() { return doc; }, r, c, store, auto };
}

main();
