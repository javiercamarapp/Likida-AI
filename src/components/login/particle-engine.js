/* Exact public Atiende canvas engine, captured 26-Oct-2026. Source SHA256 81d2299763be836077b4832aa15b5b49bacba349be232962e0fe3a812f48e76f.
 * Original engine retained. Font family alias isolates the same public IBM Plex bytes from the workspace fonts.
 * No auth, networking, analytics or application state imported.
 */
/* eslint-disable @typescript-eslint/no-unused-expressions -- Retain source comma expressions and drawing order for exact visual parity. */
function Ye(a, c) {
  const h = [...new Set(a)],
    d = 72,
    i = document.createElement("canvas");
  i.width = d * h.length, i.height = d * c.length;
  const s = i.getContext("2d");
  if (!s) return null;
  s.font = '36px "Likida Login Mono", monospace', s.textAlign = "center", s.textBaseline = "middle", c.forEach((r, u) => {
    s.fillStyle = r, s.shadowColor = r, s.shadowBlur = u === 0 ? 5 : 0, h.forEach((g, N) => {
      s.globalAlpha = u === 0 ? .45 : 1, s.fillText(g, (N + .5) * d, (u + .5) * d), u === 0 && (s.globalAlpha = 1, s.shadowBlur = 0, s.fillText(g, (N + .5) * d, (u + .5) * d), s.shadowBlur = 5);
    });
  });
  const j = new Map(h.map((r, u) => [r, u]));
  return {
    draw(r, u, g, N, b, x) {
      const E = b * 2;
      r.drawImage(i, (j.get(u) ?? 0) * d, x * d, d, d, g - E / 2, N - E / 2, E, E);
    }
  };
}
const Ie = {},
  Q = "01{}[]<>/\\+=:;%&!?$#()*-0123456789";
function Te(a, c, h = !1, d = !1) {
  const i = a.getContext("2d");
  if (!i) return () => {};
  const s = matchMedia("(prefers-reduced-motion: reduce)"),
    j = a.closest(".demo-editorial, .login-story-surface, .agent-constellation") ?? a,
    r = getComputedStyle(a),
    u = t => r.getPropertyValue(`--login-particle-${t}`).trim() || "transparent",
    g = {
      glow: u("glow"),
      wash: u("wash"),
      clear: u("clear"),
      front: u("front"),
      middle: u("middle"),
      rear: u("rear"),
      ambient: u("ambient")
    },
    N = Ye(Q, [g.front, g.middle, g.rear]);
  let b = 0,
    x = 0,
    E = 0,
    S = !1,
    L = 0,
    R = .28,
    Y = 0,
    M = 0,
    C = 0,
    $ = 0,
    P = -1e4,
    D = -1e4,
    X = 0,
    A = 0,
    B = !1,
    z = 0,
    v = 0;
  const Z = d ? 650 : h ? 4200 : 1600,
    l = (Ie[c] ?? []).flatMap(t => t.slice(1).map((n, p) => ({
      a: t[p],
      b: n,
      length: Math.hypot(n[0] - t[p][0], n[1] - t[p][1])
    }))),
    oe = l.reduce((t, n) => t + n.length, 0),
    U = Array.from({
      length: Z
    }, (t, n) => {
      const p = 1 - 2 * (n + .5) / Z,
        T = n * Math.PI * (3 - Math.sqrt(5)),
        O = Math.sqrt(1 - p * p);
      let V = O * Math.cos(T),
        q = O * Math.sin(T),
        G = p;
      if (l.length) {
        let F = (n + .5) / Z * oe,
          k = l[l.length - 1];
        for (const m of l) {
          if (F <= m.length) {
            k = m;
            break;
          }
          F -= m.length;
        }
        const ne = F / k.length,
          o = Math.sin(n * 12.9898) * .027;
        V = k.a[0] + (k.b[0] - k.a[0]) * ne + o, G = k.a[1] + (k.b[1] - k.a[1]) * ne + Math.cos(n * 7.31) * .027, q = Math.sin(n * 4.79) * .12;
      }
      return {
        x: V,
        y: G,
        z: q,
        glyph: Q[n % Q.length] ?? "+",
        seed: n,
        ox: 0,
        oy: 0,
        vx: 0,
        vy: 0
      };
    });
  function _() {
    if (!i || !b || !x) return;
    i.clearRect(0, 0, b, x);
    const t = h ? Math.max(b * .63, x * .77) : Math.min(b, x) * .39,
      n = b * .5 + C * 9,
      p = h ? t * 1.06 + x * .045 : x * .5,
      T = i.createRadialGradient(n, p - t * .25, 0, n, p, t * 1.18);
    T.addColorStop(0, g.glow), T.addColorStop(.6, g.wash), T.addColorStop(1, g.clear), i.fillStyle = T, i.fillRect(0, 0, b, x);
    const O = (l.length ? Math.sin(R) * .08 : R) + C * .22,
      V = -.12 + $ * .12,
      q = Math.cos(O),
      G = Math.sin(O),
      F = Math.cos(V),
      k = Math.sin(V),
      ne = U.map(o => {
        const m = Math.sin(o.x * 4.7 + o.y * 3.2 + v * 1.2) * Math.cos(o.z * 3.8 - v * .73),
          w = Math.sin(o.y * 8.2 - o.z * 3.1 + v * 1.65),
          y = s.matches ? .025 : .07 + z * .09,
          W = 1 + y * m + y * .38 * w,
          re = Math.sin(o.y * 3.4 + v * .8) * y,
          K = o.x * W + o.z * re,
          J = o.y * W + Math.sin(o.x * 5 + v) * y * .28,
          le = o.z * W,
          ue = K * q - le * G,
          ce = K * G + le * q;
        return {
          ...o,
          x: ue,
          y: J * F - ce * k,
          z: J * k + ce * F
        };
      }).sort((o, m) => o.z - m.z);
    i.textAlign = "center", i.textBaseline = "middle";
    for (const o of ne) {
      const m = l.length ? .48 + o.seed % 9 / 18 : Math.max(0, Math.min(1, (o.z + 1.2) / 2.4)),
        w = 2.9 / (2.9 - o.z * .35),
        y = U[o.seed],
        W = n + o.x * t * w,
        re = p + o.y * t * w;
      if (A && !s.matches) {
        const me = W + y.ox - P,
          he = re + y.oy - D,
          de = Math.hypot(me, he),
          xe = Math.min(245, t * .58),
          fe = de < xe ? (1 - de / xe) ** 2 * 2600 * (.3 + m) : 0;
        y.vx += ((me - he * .85) / Math.max(1, de) * fe - y.ox * 20 - y.vx * 8) * A, y.vy += ((he + me * .85) / Math.max(1, de) * fe - y.oy * 20 - y.vy * 8) * A, y.ox += y.vx * A, y.oy += y.vy * A;
      }
      const K = W + y.ox,
        J = re + y.oy,
        le = Q[(o.seed + Math.floor((X + o.seed * 173) / (1800 + o.seed % 7 * 240))) % Q.length];
      if (J < -20 || J > x + 20 || K < -20 || K > b + 20) continue;
      const ue = .71 + o.seed % 7 * .065,
        ce = Math.max(7, Math.min(22, t * (d ? .075 : .037))) * (.38 + m * 1.08) * ue,
        pe = Math.max(0, -o.y) * (.5 + m * .5),
        je = m * .82 + pe * .42 - o.x * .18;
      i.globalAlpha = Math.min(1, (h ? .18 : .12) + m * .75 + pe * .45), N?.draw(i, le, K, J, ce, je > .78 ? 0 : m > .4 ? 1 : 2);
    }
    i.globalAlpha = .13, i.fillStyle = g.ambient, i.font = "11px monospace";
    for (let o = 0; o < 15; o++) i.fillText(Q[o] ?? "+", o * 97 % 101 / 101 * b, o * 53 % 101 / 101 * x);
    i.globalAlpha = 1;
  }
  function H() {
    cancelAnimationFrame(E), E = 0, L = 0;
  }
  function se(t) {
    if (s.matches) {
      I();
      return;
    }
    if (!S || document.hidden || s.matches) {
      H();
      return;
    }
    if (!L || t - L >= 33) {
      const n = L ? Math.min(t - L, 80) : 33;
      A = n / 1e3, X += n, z += ((B ? 1 : 0) - z) * (1 - Math.exp(-n / (B ? 240 : 950))), v += n * 55e-5 * (1 + z * 3.2), R += n * 45e-6 * (1 + z * 4.5);
      const p = 1 - Math.exp(-n / 190);
      C += (Y - C) * p, $ += (M - $) * p, L = t, _();
    }
    E = requestAnimationFrame(se);
  }
  function I() {
    if (H(), A = 0, s.matches) {
      B = !1, z = 0, C = $ = Y = M = 0, P = D = -1e4;
      for (const t of U) t.ox = t.oy = t.vx = t.vy = 0;
    }
    a.dataset.motion = s.matches ? "reduced" : "interactive", _(), S && !document.hidden && !s.matches && (E = requestAnimationFrame(se));
  }
  function ae(t) {
    if (s.matches || t.pointerType === "touch") return;
    B = !0;
    const n = a.getBoundingClientRect();
    P = t.clientX - n.left, D = t.clientY - n.top;
    const p = j.getBoundingClientRect();
    Y = Math.max(-1, Math.min(1, (t.clientX - p.left) / p.width * 2 - 1)), M = Math.max(-1, Math.min(1, (t.clientY - p.top) / p.height * 2 - 1));
  }
  function ee() {
    B = !1, Y = M = 0, P = D = -1e4;
  }
  const ie = new ResizeObserver(() => {
      const t = a.getBoundingClientRect();
      b = t.width, x = t.height;
      const n = Math.min(devicePixelRatio || 1, 1.5);
      a.width = Math.round(b * n), a.height = Math.round(x * n), i.setTransform(n, 0, 0, n, 0, 0), _();
    }),
    te = new IntersectionObserver(([t]) => {
      S = !!t?.isIntersecting, I();
    });
  return ie.observe(a), te.observe(a), j.addEventListener("pointermove", ae, {
    passive: !0
  }), j.addEventListener("pointerleave", ee), document.addEventListener("visibilitychange", I), s.addEventListener("change", I), I(), () => {
    H(), ie.disconnect(), te.disconnect(), j.removeEventListener("pointermove", ae), j.removeEventListener("pointerleave", ee), document.removeEventListener("visibilitychange", I), s.removeEventListener("change", I);
  };
}
export { Te as mountLoginParticles };
