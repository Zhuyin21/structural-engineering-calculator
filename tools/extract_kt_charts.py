"""Read the stress-concentration charts of Shigley's Table A-15 out of the
book's PDF and write them as numbers to src/kt/chartdata.js.

The charts are stored in the PDF as vector curves, so they can be read
exactly instead of by eye: each chart's frame and tick labels calibrate the
axes, and each Bezier curve is sampled and converted to (x, Kt) pairs.

Usage:  python3 tools/extract_kt_charts.py path/to/Shigley_11th.pdf
Needs:  pip install pymupdf
The PDF itself is not part of this repository.
"""
import json, sys
import pymupdf

# PDF page index (0-based) -> charts on it, top to bottom, with the curve
# labels listed from the highest curve to the lowest.
PAGES = {
    1062: [('A-15-1', 'd/w', None, [None]),
           ('A-15-2', 'd/w', 'd/h', [0, 0.25, 0.5, 1.0, 2.0, 'inf']),
           ('A-15-3', 'r/d', 'w/d', [3, 1.5, 1.2, 1.1, 1.05])],
    1063: [('A-15-4', 'r/d', 'w/d', ['inf', 1.5, 1.10, 1.05, 1.02]),
           ('A-15-5', 'r/d', 'D/d', [1.5, 1.10, 1.05, 1.02]),
           ('A-15-6', 'r/d', 'D/d', [3, 1.3, 1.1, 1.05, 1.02])],
    1064: [('A-15-7', 'r/d', 'D/d', [1.5, 1.10, 1.05, 1.02]),
           ('A-15-8', 'r/d', 'D/d', [2, 1.33, 1.20, 1.09]),
           ('A-15-9', 'r/d', 'D/d', [3, 1.5, 1.10, 1.05, 1.02])],
    1066: [('A-15-13', 'r/d', 'D/d', [1.5, 1.15, 1.05, 1.02]),
           ('A-15-14', 'r/d', 'D/d', [1.5, 1.05, 1.02]),
           ('A-15-15', 'r/d', 'D/d', [1.30, 1.05, 1.02])],
}
N = 36          # samples kept per curve


def fit(pairs):
    """Least-squares line value = a * coordinate + b."""
    n = len(pairs); sx = sum(p[0] for p in pairs); sy = sum(p[1] for p in pairs)
    sxx = sum(p[0] ** 2 for p in pairs); sxy = sum(p[0] * p[1] for p in pairs)
    a = (n * sxy - sx * sy) / (n * sxx - sx * sx)
    return a, (sy - a * sx) / n


def bezier(p0, p1, p2, p3, m=60):
    for i in range(m + 1):
        t = i / m; u = 1 - t
        yield (u**3 * p0.x + 3*u*u*t * p1.x + 3*u*t*t * p2.x + t**3 * p3.x,
               u**3 * p0.y + 3*u*u*t * p1.y + 3*u*t*t * p2.y + t**3 * p3.y)


def interp(xs, ys, x):
    for i in range(1, len(xs)):
        if x <= xs[i]:
            t = (x - xs[i - 1]) / (xs[i] - xs[i - 1])
            return ys[i - 1] + t * (ys[i] - ys[i - 1])
    return ys[-1]


def main(path):
    doc = pymupdf.open(path)
    out = {}
    for pno, charts in PAGES.items():
        page = doc[pno]
        drawings = page.get_drawings()
        words = page.get_text('words')
        frames = sorted((d['rect'] for d in drawings if len(d['items']) == 1 and d['items'][0][0] == 're' and d.get('fill') is None
                         and d['rect'].width > 150 and d['rect'].height > 100), key=lambda r: r.y0)
        assert len(frames) == len(charts), (pno, len(frames))
        for frame, (name, xvar, pvar, labels) in zip(frames, charts):
            num = lambda w: w[4].replace('.', '', 1).isdigit()
            xt = [((w[0] + w[2]) / 2, float(w[4])) for w in words if num(w) and frame.y1 < (w[1] + w[3]) / 2 < frame.y1 + 12 and frame.x0 - 6 < (w[0] + w[2]) / 2 < frame.x1 + 6]
            yt = [((w[1] + w[3]) / 2, float(w[4])) for w in words if num(w) and frame.x0 - 18 < (w[0] + w[2]) / 2 < frame.x0 - 2 and frame.y0 - 4 < (w[1] + w[3]) / 2 < frame.y1 + 3]
            ax, bx = fit(xt)
            ay, _ = fit(yt)
            by = min(v for _, v in yt) - ay * frame.y1          # the frame's bottom edge is the lowest tick
            # the curves: dark, unfilled, 1 pt wide Bezier paths inside the frame
            curves = []
            for d in drawings:
                if d.get('fill') is not None or abs((d.get('width') or 0) - 1.0) > 0.05: continue
                if not (d['rect'].x0 > frame.x0 - 3 and d['rect'].x1 < frame.x1 + 3 and d['rect'].y0 > frame.y0 - 3 and d['rect'].y1 < frame.y1 + 3): continue
                if d['rect'].width < 60: continue
                for it in d['items']:
                    if it[0] != 'c': continue
                    pts = list(bezier(*it[1:5]))
                    if curves and abs(curves[-1][-1][0] - pts[0][0]) < 0.3 and abs(curves[-1][-1][1] - pts[0][1]) < 0.3:
                        curves[-1].extend(pts[1:])
                    else:
                        curves.append(pts)
            data = []
            for pts in curves:
                xy = sorted((ax * px + bx, ay * py + by) for px, py in pts)
                xs = [p[0] for p in xy]; ks = [p[1] for p in xy]
                lo, hi = xs[0], xs[-1]
                gx = [lo + (hi - lo) * (i / (N - 1)) ** 2 for i in range(N)]      # denser where the curve is steep
                data.append({'x': [round(v, 5) for v in gx], 'k': [round(interp(xs, ks, v), 4) for v in gx]})
            assert len(data) == len(labels), (name, len(data), len(labels))
            # order from the highest curve to the lowest at a position they all cover
            ref = max(c['x'][0] for c in data) + 0.35 * (min(c['x'][-1] for c in data) - max(c['x'][0] for c in data))
            data.sort(key=lambda c: -interp(c['x'], c['k'], ref))
            for c, lab in zip(data, labels): c['p'] = lab
            out[name] = {'x': xvar, 'p': pvar, 'xTicks': sorted(v for _, v in xt), 'kTicks': sorted(v for _, v in yt), 'curves': data}
            print(name, 'curves', len(data), ' '.join(f"{c['p']}:[{c['x'][0]:.3f},{c['x'][-1]:.3f}] K {c['k'][0]:.2f}->{c['k'][-1]:.2f}" for c in data))
    return out


if __name__ == '__main__':
    data = main(sys.argv[1])
    body = json.dumps(data, separators=(',', ':'))
    target = sys.argv[2] if len(sys.argv) > 2 else 'src/kt/chartdata.js'
    with open(target, 'w') as f:
        f.write("// Stress-concentration charts of Shigley's Mechanical Engineering Design, 11th ed.,\n"
                "// Table A-15, as numbers. Generated by tools/extract_kt_charts.py from the curves in\n"
                "// the book's PDF; do not edit by hand. The charts are from R. E. Peterson, \"Design\n"
                "// Factors for Stress Concentration\", Machine Design, vol. 23, 1951.\n"
                "//   x: the horizontal variable, p: the quantity that labels each curve ('inf' = infinity),\n"
                "//   curves[i].x / .k: points along one curve.\n"
                f"export const CHARTS = {body};\n")
    print('wrote', target)
