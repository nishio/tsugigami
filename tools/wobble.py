#!/usr/bin/env python3
"""線の「ガタつき」を数値にする。

  画像(スクリーンショット、issue #1 の見本など):
    python3 tools/wobble.py raw/2026-10-27_issue1_テイスト.png --crop 0,0,520,559
  書き出した JSON(ノート一覧の「書き出す」):
    python3 tools/wobble.py backup.json [--note <id>] [--render out.png]

測り方(画像):
  1. 紙より暗い画素(min(R,G,B) が --dark 未満)をインクとみなし、輪郭を副画素精度で取る。
  2. 輪郭を 0.5 px 刻みで等間隔に取り直し、長さ --lam px の窓で 3 次多項式を当てはめて(Savitzky-Golay)
     なめらかな線を作る。
  3. 元の輪郭がそのなめらかな線から法線方向にどれだけ離れているか(頑健な標準偏差、px)を「ズレ」とする。あわせて進行方向の角度のブレ(度)も出す。
     --lam より短い波長の揺れだけが数えられる(既定は 8 px と 16 px の 2 通り)。線の太さは 2×面積/周長で推定して併記する。
  注意: 窓より小さい半径の曲がり(線の端の半円、小さな折り返し)も残差に混ざるので、中央値ベースの頑健な
     標準偏差で数える。それでも文字の大きさや形で値は動くので、比べるときは同じ文字を同じ大きさで書く。
  JSON では、さらに入力点そのもの(x, y の並び)で同じ計算をし、画面に描く前の揺れも出す
  (入力点の「角度」は点の間隔が 1 px を超えると折れ線の角が混ざって当てにならない。「ズレ」を見る)。
  --bar x0,y0,x1,y1[,v] で、ほぼまっすぐな 1 画(横棒。v を付けると縦棒)の切り出しを指定すると、
  各列のインクの重心を中心線にして 3 次曲線からの残差を出す。窓の長さに依らない「うねり」の量。
  JSON の描画は本体と同じ「中点から中点への 2 次曲線」で、--scale 倍(既定 2 = iPad の dpr)に描く。

必要なもの: numpy, scipy, scikit-image, pillow
"""
import argparse
import json
import math
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy.signal import savgol_filter
from skimage.measure import find_contours

DS = 0.5  # 輪郭の取り直し間隔(px)


def resample(P, ds=DS, closed=False):
    """折れ線 P (n,2) を弧長 ds 刻みに取り直す"""
    if closed:
        P = np.vstack([P, P[:1]])
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    L = s[-1]
    if L < ds * 4:
        return None, L
    n = int(L / ds)
    t = np.linspace(0, L, n, endpoint=not closed)
    x = np.interp(t, s, P[:, 0])
    y = np.interp(t, s, P[:, 1])
    return np.column_stack([x, y]), L


def wobble_of(Q, lam, closed=False):
    """等間隔点列 Q の揺れ。(法線方向のズレ px, 進行方向の角度のブレ 度)、どちらも頑健な標準偏差

    どちらも「長さ lam の窓で 3 次多項式を当てはめた滑らかな線」からの残差。
    位置のズレは直感的だが、窓より小さい半径の曲がりも残差に混ざる(曲率のバイアス)。
    角度のブレは円弧なら角度が弧長に比例するので、曲がりそのものは残差に出にくい。
    """
    w = int(round(lam / DS)) | 1
    if w < 5 or len(Q) <= w:
        return None
    mode = 'wrap' if closed else 'interp'
    S = np.column_stack([savgol_filter(Q[:, i], w, 3, mode=mode) for i in range(2)])
    T = np.gradient(S, axis=0)
    T /= np.maximum(np.linalg.norm(T, axis=1, keepdims=True), 1e-9)
    N = np.column_stack([-T[:, 1], T[:, 0]])
    d = np.sum((Q - S) * N, axis=1)
    # 線の端(半円の cap)や窓より小さい曲がりは残差が大きくなるが、線の長さの一部でしかない。
    # 揺れは線全体にあるので、中央値から出した頑健な標準偏差(MAD × 1.4826)で数える。
    rob = lambda v: float(1.4826 * np.median(np.abs(v - np.median(v))))
    # 角度は、画素のギザギザ(1 px 未満)を落とした線から取る
    w0 = int(round(2.0 / DS)) | 1
    S0 = np.column_stack([savgol_filter(Q[:, i], w0, 2, mode=mode) for i in range(2)])
    D = np.gradient(S0, axis=0)
    th = np.unwrap(np.arctan2(D[:, 1], D[:, 0]))
    r = th - savgol_filter(th, w, 3, mode=mode)
    return rob(d), float(np.degrees(rob(r)))


def summarize(items, lam, label):
    """items: [(wobble, length)]"""
    items = [(w, L) for w, L in items if w is not None]
    if not items:
        print(f'{label}: 測れる線がない')
        return None
    w = np.array([i[0][0] for i in items])
    a = np.array([i[0][1] for i in items])
    L = np.array([i[1] for i in items])
    mean = float(np.sum(w * L) / np.sum(L))
    amean = float(np.sum(a * L) / np.sum(L))
    print(f'{label}: ズレ {mean:.3f} px(中央値 {np.median(w):.3f}, 90% {np.percentile(w, 90):.3f})'
          f'  角度 {amean:.2f}°(中央値 {np.median(a):.2f}, 90% {np.percentile(a, 90):.2f})'
          f'  窓 {lam:.1f} px, 線 {len(items)} 本, 総長 {np.sum(L):.0f} px')
    return mean


# ---- 画像 ----

def ink_field(img, dark):
    a = np.asarray(img.convert('RGBA'), dtype=np.float32)
    rgb = a[..., :3] * (a[..., 3:4] / 255) + 255 * (1 - a[..., 3:4] / 255)
    return (255 - rgb.min(axis=2)) / 255, dark


def measure_image(path, crop, lams, dark, label=None):
    img = path if isinstance(path, Image.Image) else Image.open(path)
    if crop:
        img = img.crop(crop)
    f, _ = ink_field(img, dark)
    level = (255 - dark) / 255
    mask = f > level
    contours = find_contours(f, level)
    # 太さの推定: 2 × 面積 / 周長(細長い線なら太さに近い)
    perim = sum(np.sum(np.linalg.norm(np.diff(c, axis=0), axis=1)) for c in contours)
    width = 2 * mask.sum() / perim if perim else 0
    print(f'{label or path}: 推定の太さ {width:.2f} px(インク {int(mask.sum())} px², 輪郭 {len(contours)} 本)')
    res = []
    for lam in lams:
        items = []
        for c in contours:
            closed = np.allclose(c[0], c[-1])
            Q, L = resample(c[:, ::-1], closed=closed)  # (row, col) → (x, y)
            if Q is None or L < 3 * lam:
                continue
            items.append((wobble_of(Q, lam, closed), L))
        res.append(summarize(items, lam, '  輪郭'))
    return res, width


def measure_bar(path, box, vertical):
    """ほぼまっすぐな 1 画: 列ごとのインクの重心を中心線にし、3 次曲線からの残差を出す"""
    img = Image.open(path).crop(box)
    f, _ = ink_field(img, 255)
    if vertical:
        f = f.T
    H, W = f.shape
    m = f.sum(axis=0)
    ok = m > 1.0
    yc = (f * np.arange(H)[:, None]).sum(axis=0)[ok] / m[ok]
    x = np.arange(W)[ok]
    good = m[ok] < 1.6 * np.median(m[ok])  # 交差で太くなる列は外す
    x, yc = x[good], yc[good]
    r = yc - np.polyval(np.polyfit(x, yc, 3), x)
    rob = 1.4826 * np.median(np.abs(r - np.median(r)))
    print(f'{path} {box}: 長さ {len(x)} 列, 太さ {np.median(m[ok]):.2f} px, 中心線の 3 次曲線からの残差: 頑健σ {rob:.3f} px, 90% {np.percentile(np.abs(r), 90):.2f} px')


# ---- JSON ----

def quad_flatten(P, k=8):
    """本体と同じ: 点 i→i+1 を中点から中点への 2 次曲線にして折れ線に展開"""
    n = len(P)
    if n == 1:
        return P
    out = [P[0]]
    for i in range(1, n):
        p0 = (P[i - 1] + P[i]) / 2 if i > 1 else P[0]
        c = P[i - 1]
        p1 = (P[i - 1] + P[i]) / 2
        if i == 1:
            out.append(p1)
            continue
        t = np.linspace(0, 1, k + 1)[1:, None]
        out.extend((1 - t) ** 2 * p0 + 2 * (1 - t) * t * c + t * t * p1)
    out.append(P[-1])
    return np.array(out)


def render(strokes, scale, ss=4):
    """ペンの線を白地に描く。ss 倍で描いて縮小し、アンチエイリアスをかける"""
    pts = [s['P'] for s in strokes]
    allp = np.vstack(pts)
    pad = 20
    x0, y0 = allp.min(axis=0) - pad
    x1, y1 = allp.max(axis=0) + pad
    W, H = int((x1 - x0) * scale), int((y1 - y0) * scale)
    img = Image.new('RGB', (W * ss, H * ss), 'white')
    d = ImageDraw.Draw(img)
    for s in strokes:
        Q = (quad_flatten(s['P']) - [x0, y0]) * scale * ss
        w = s['width'] * scale * ss
        if len(Q) == 1:
            x, y = Q[0]
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=s['color'])
            continue
        d.line([tuple(p) for p in Q], fill=s['color'], width=int(round(w)), joint='curve')
        for x, y in (Q[0], Q[-1]):
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=s['color'])
    return img.resize((W, H), Image.LANCZOS)


def measure_json(path, note, lams, dark, scale, out, last=0):
    data = json.load(open(path))
    if data.get('format') != 'tsugigami-backup':
        sys.exit('tsugigami のバックアップではない')
    notes = {n['id']: n for n in data['notes']}
    if note is None:
        note = max(data['notes'], key=lambda n: n['updated'])['id']
    print(f'ノート: {notes[note]["title"]} ({note})')
    strokes = []
    for s in data['strokes']:
        if s['noteId'] != note or s['kind'] != 'pen':
            continue
        P = np.array(s['pts'], dtype=np.float64).reshape(-1, 3)[:, :2]
        strokes.append({'P': P, 'width': s['width'], 'color': s['color'], 'z': s['z']})
    strokes.sort(key=lambda s: s['z'])
    if not strokes:
        sys.exit('ペンの線がない')
    if last:
        strokes = strokes[-last:]
    width = float(np.median([s['width'] for s in strokes]))
    npts = [len(s['P']) for s in strokes]
    spacing = [float(np.mean(np.linalg.norm(np.diff(s['P'], axis=0), axis=1))) for s in strokes if len(s['P']) > 1]
    print(f'ペンの線 {len(strokes)} 本, 太さ(中央値) {width} px, 1 本あたり {np.mean(npts):.0f} 点, 点の間隔 {np.median(spacing):.2f} px(中央値)')
    # 入力点そのものの揺れ(ノート座標、等倍 CSS px)
    for lam in lams:
        lam_in = lam / scale
        items = []
        for s in strokes:
            Q, L = resample(s['P'])
            if Q is None or L < 3 * lam_in:
                continue
            items.append((wobble_of(Q, lam_in), L))
        summarize(items, lam_in, '  入力点(等倍 px)')
    # 本体と同じ描き方で描いた画像で、見本と同じ測り方
    img = render(strokes, scale)
    if out:
        img.save(out)
        print(f'  描画を {out} に保存')
    measure_image(img, None, lams, dark, label=f'  描画({scale} 倍)')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('path')
    ap.add_argument('--crop', help='画像の切り出し x0,y0,x1,y1')
    ap.add_argument('--lam', default='8,16', help='揺れを数える窓の長さ(px、コンマ区切り)。既定 8,16')
    ap.add_argument('--dark', type=int, default=120, help='min(R,G,B) がこれ未満をインクとみなす')
    ap.add_argument('--note', help='JSON のどのノートか(既定: 最後に更新したノート)')
    ap.add_argument('--scale', type=float, default=2, help='JSON を描く倍率(既定 2 = iPad の dpr)')
    ap.add_argument('--render', help='JSON を描いた PNG の保存先')
    ap.add_argument('--last', type=int, default=0, help='JSON の、最後に書いた N 本だけを使う')
    ap.add_argument('--bar', help='画像の、まっすぐな 1 画の切り出し x0,y0,x1,y1[,v]。中心線のうねりを出す')
    a = ap.parse_args()
    lams = [float(v) for v in a.lam.split(',')]
    if a.path.endswith('.json'):
        measure_json(a.path, a.note, lams, a.dark, a.scale, a.render, a.last)
    elif a.bar:
        parts = a.bar.split(',')
        measure_bar(a.path, tuple(int(v) for v in parts[:4]), len(parts) > 4 and parts[4] == 'v')
    else:
        crop = tuple(int(v) for v in a.crop.split(',')) if a.crop else None
        measure_image(a.path, crop, lams, a.dark)


if __name__ == '__main__':
    main()
