/* picture-ghost.js: the letter's PICTURE laid over the learner's own hand on the camera view (the owner, 19 Oct 2026,
 * after trying the hand drawn from tracked points: "too many joints ... can u not just use this", pointing at the
 * picture). The same clean line drawing as beside the camera, as white lines, sitting on the learner's palm at their
 * hand's size.
 *
 * WHERE IT GOES. In a FIXED SPOT (SPOT: right of centre on screen, where a right hand is held in the camera check;
 * mirrored for a left hand), pointing the way the letter does (G and H sideways, P and Q down), for the learner to put
 * their hand into (the owner, 19 Oct: "do we even need it to follow the hand? can't we keep it in a spot and have them
 * fit it" -- following the hand, the drawing's proportions never quite matched it). Only its SIZE follows the learner:
 * W->M (the picture's wrist and middle knuckle, marked by hand in tutor/ghost-pictures.json; MediaPipe finds no hand in
 * a line drawing) as long as their wrist -> middle knuckle (3-D palm size x PALM_LENGTH), changing slowly, so it fits a
 * learner near the camera or far from it without shivering. { follow: true } puts it on the hand instead (its palm on
 * the palm, the size from the hand on screen within SIZE_RANGE of the 3-D palm), still never turning.
 *
 * WHAT IT SAYS (the coach's `look`, coach.js): white lines; green lines when the grader would accept the hand as it
 * is now; amber lines when the hand is turned wrong; and for the finger (or thumb) the grader's blame would change, a
 * GOLDEN FINGER that starts on the learner's own finger and slides to where it should be, pauses there, and starts
 * again (the owner, 19 Oct: "animate into the right spot so ik how to move my finger"). Where it should be comes from
 * the letter's real hand (tutor/ghost-hands.json, the one closest to how fluent signers make it): that hand's palm is
 * fitted onto the learner's palm (wrist, thumb base and the four knuckles; a 2-D similarity), and its finger, carried
 * along, is the goal. The learner's own finger also glows faintly, and the goal is dotted, so start and end are clear.
 *
 * The canvas is inside the mirrored stage (js/core/experiment.js), in the camera's unmirrored coordinates, so the
 * picture is put on it flipped: on screen it then reads exactly as it does beside the camera. */

import { palmSize } from "../../tutor/hand-frame.js";
import { pictureMirrored } from "../../tutor/letters.js";
import { FINGER_POINTS } from "./ghost.js";

export const PALM_LENGTH = 1.07;   // wrist -> middle knuckle in palm sizes (median of the 26 ghost hands, 3-D)
export const PALM_AT = 0.75;       // the middle of a palm, as a fraction of the way from the wrist to the middle knuckle
export const SIZE_RANGE = [0.75, 1.15];   // follow mode: the picture's size, as a fraction of the size the 3-D palm says
/* The fixed spot for the picture's palm, as a fraction of the picture ON SCREEN (x from the left, y from the top), for
 * a right hand; and how fast its size follows the learner's hand (per frame). */
export const SPOT = Object.freeze({ x: 0.66, y: 0.55 });
export const SIZE_EASE = 0.06;
const RASTER = 500;                // tutor/ghost-pictures.json was marked at this width

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const palmCenter = (P) => [0, 5, 9, 13, 17].reduce((a, i) => [a[0] + P[i][0] / 5, a[1] + P[i][1] / 5], [0, 0]);

/** The learner's hand on the canvas, in pixels: wrist, middle knuckle and 3-D palm size. */
export function anchorOf(landmarks, W, H) {
  if (!landmarks || landmarks.length !== 21) return null;
  const P = landmarks.map((p) => [p.x * W, p.y * H, (p.z ?? 0) * W]);
  const s = palmSize(P);
  if (!(Number.isFinite(s) && s > 0)) return null;
  return { w: [P[0][0], P[0][1]], m: [P[9][0], P[9][1]], s };
}

/** The picture's marked points, on the canvas's side. They were marked on the picture as it is shown beside the
 * camera; the canvas is shown mirrored, so the picture is ALWAYS laid on it as the mirror image of that (canvasFlipped
 * just says how to get there from the SVG file), and so are its points. (Flipping them only when the SVG was flipped
 * pinned every viewer-drawn letter's picture to the wrong place: the owner's L sat a hand's width off, 19 Oct.) */
export function picturePoints(points, letter, hand, width = RASTER) {
  const p = points[letter];
  if (!p) return null;
  // marked for a right-handed learner; for a left-handed one the picture beside the camera is itself mirrored
  const shown = hand === "left" ? (q) => [width - q[0], q[1]] : (q) => [q[0], q[1]];
  const f = (q) => { const r = shown(q); return [width - r[0], r[1]]; };
  return { W: f(p.W), M: f(p.M) };
}
/* How the SVG file goes on the canvas: the mirror image of how it is shown beside the camera (pictureMirrored). */
export const canvasFlipped = (letter, hand) => !pictureMirrored(letter, hand);

/**
 * Where the picture should be, for its W and M and the learner's hand: its palm point (PALM_AT of the way from W to
 * M) at (x, y), at its own angle (th = 0, always), scaled by k.
 */
export function pictureTarget({ W, M }, hand) {
  const len = Math.hypot(M[0] - W[0], M[1] - W[1]);
  const ux = hand.m[0] - hand.w[0], uy = hand.m[1] - hand.w[1], ulen = Math.hypot(ux, uy);
  const k3 = (hand.s * PALM_LENGTH) / len;
  const k = ulen > 0 ? Math.max(SIZE_RANGE[0] * k3, Math.min(SIZE_RANGE[1] * k3, ulen / len)) : k3;
  return { x: hand.w[0] + PALM_AT * ux, y: hand.w[1] + PALM_AT * uy, th: 0, k };
}

/** The fixed spot on the canvas (shown mirrored, so the screen's x is flipped), for a canvas W x H and a hand. */
export function spotOf(W, H, hand = "right") {
  const sx = hand === "left" ? 1 - SPOT.x : SPOT.x;
  return { x: (1 - sx) * W, y: SPOT.y * H };
}

/** The canvas transform (a b c d e f, for setTransform) putting the picture's palm point at (x, y), turned and scaled. */
export function transformOf({ W, M }, { x, y, th, k }) {
  const cx = W[0] + PALM_AT * (M[0] - W[0]), cy = W[1] + PALM_AT * (M[1] - W[1]);
  const a = k * Math.cos(th), b = k * Math.sin(th);
  return { a, b, c: -b, d: a, e: x - (a * cx - b * cy), f: y - (b * cx + a * cy) };
}
export const applyTransform = (t, [x, y]) => [t.a * x + t.c * y + t.e, t.b * x + t.d * y + t.f];

/* A picture as white-on-clear line art, on the canvas's side, RASTER wide: alpha from how dark each pixel is. */
async function lineArt(url, flip) {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  const w = RASTER, h = Math.round((RASTER * img.naturalHeight) / img.naturalWidth);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, h);
  if (flip) { g.translate(w, 0); g.scale(-1, 1); }
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h);
  for (let i = 0; i < d.data.length; i += 4) {
    const lum = (d.data[i] * 0.299 + d.data[i + 1] * 0.587 + d.data[i + 2] * 0.114) / 255;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = 255;
    d.data[i + 3] = Math.round(255 * Math.max(0, Math.min(1, (1 - lum) * 1.25)));
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.putImageData(d, 0, 0);
  return c;
}
function tinted(mask, color) {
  const c = document.createElement("canvas");
  c.width = mask.width; c.height = mask.height;
  const g = c.getContext("2d");
  g.drawImage(mask, 0, 0);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

export const LINE = Object.freeze({ neutral: "#ffffff", match: "#22c55e", turn: "#f59e0b" });
export const LINE_ALPHA = 0.92;
const GOLD = { fill: "rgba(251, 191, 36, 0.9)", line: "rgba(146, 64, 14, 0.95)", glow: "rgba(245, 158, 11, 0.35)" };
const PALM_FIT = [0, 1, 5, 9, 13, 17];

/** The 2-D similarity (complex z, then + t) that best puts points S onto points D (least squares, no reflection). */
export function fitSimilarity(S, D) {
  const n = S.length;
  const sc = S.reduce((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n], [0, 0]);
  const dc = D.reduce((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n], [0, 0]);
  let re = 0, im = 0, ss = 0;
  for (let i = 0; i < n; i++) {
    const sx = S[i][0] - sc[0], sy = S[i][1] - sc[1], dx = D[i][0] - dc[0], dy = D[i][1] - dc[1];
    re += sx * dx + sy * dy; im += sx * dy - sy * dx; ss += sx * sx + sy * sy;
  }
  const zr = re / ss, zi = im / ss;
  return (p) => [dc[0] + zr * (p[0] - sc[0]) - zi * (p[1] - sc[1]), dc[1] + zi * (p[0] - sc[0]) + zr * (p[1] - sc[1])];
}

/** Where each finger of the letter's real hand would be on the learner's hand: { finger: [[x, y] x 4] } on the canvas. */
export function goalFingers(template, P, hand = "right") {
  const m = hand === "left" ? -1 : 1;
  const T = template.map((p) => [m * p[0], p[1]]);
  const f = fitSimilarity(PALM_FIT.map((i) => T[i]), PALM_FIT.map((i) => P[i]));
  const out = {};
  for (const [name, ix] of Object.entries(FINGER_POINTS)) out[name] = ix.map((i) => f(T[i]));
  return out;
}

/* The golden finger's journey, as a fraction 0..1 of the way from the learner's finger to the goal, for a time:
 * rest on the finger, glide (eased), rest at the goal, fade, again. */
export const MOVE_MS = 1800;
export function journey(tMs) {
  const u = ((tMs % MOVE_MS) + MOVE_MS) % MOVE_MS / MOVE_MS;
  if (u < 0.15) return { f: 0, alpha: 0.9 };
  if (u < 0.6) { const v = (u - 0.15) / 0.45; return { f: v < 0.5 ? 2 * v * v : 1 - 2 * (1 - v) * (1 - v), alpha: 0.9 }; }
  if (u < 0.85) return { f: 1, alpha: 0.9 };
  return { f: 1, alpha: 0.9 * (1 - (u - 0.85) / 0.15) };
}

function fingerPath(ctx, pts) {
  ctx.beginPath();
  pts.forEach((q, k) => (k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
}

/**
 * One per session. `load(letters, pictureUrl)` prepares the pictures; `draw` is called every frame after the canvas
 * was cleared.
 * @param {{points: object, templates?: object, hand?: "right"|"left", smoothing?: number}} o
 *   templates: tutor/ghost-hands.json letters, for where the golden finger goes (none: the finger only glows)
 *   follow: put the picture on the hand instead of in its spot
 */
export function createPictureGhost({ points, templates = null, hand = "right", smoothing = 0.45, follow = false }) {
  const art = {};     // letter -> { neutral, match, turn } canvases
  let cur = null;     // where the picture is now: { x, y, th, k }
  return {
    async load(letters, pictureUrl) {
      await Promise.all([...new Set(letters)].filter((L) => points[L] && pictureUrl(L)).map(async (L) => {
        const mask = await lineArt(pictureUrl(L), canvasFlipped(L, hand));
        art[L] = { neutral: tinted(mask, LINE.neutral), match: tinted(mask, LINE.match), turn: tinted(mask, LINE.turn) };
      }));
    },
    has: (L) => !!art[L],
    reset() { cur = null; },
    draw(ctx, canvas, landmarks, letter, look = null, tMs = 0) {
      const pics = art[letter], pp = picturePoints(points, letter, hand);
      if (!pics || !pp) return;
      const W = canvas.width, H = canvas.height;
      const green = look?.state === "match" || look?.state === "accepted";
      const blocks = look?.state === "fix" ? look.blocks ?? [] : [];
      const turned = blocks.includes("orientation");
      const hand0 = anchorOf(landmarks, W, H);
      const len = Math.hypot(pp.M[0] - pp.W[0], pp.M[1] - pp.W[1]);
      if (follow) {
        if (hand0) {
          const want = pictureTarget(pp, hand0);
          cur = cur ? { x: cur.x + smoothing * (want.x - cur.x), y: cur.y + smoothing * (want.y - cur.y),
            k: cur.k + smoothing * (want.k - cur.k), th: 0 } : want;
        }
      } else {
        // in its spot; only the size eases toward the learner's hand
        const spot = spotOf(W, H, hand);
        const kWant = ((hand0?.s ?? (cur ? null : H * 0.2)) * PALM_LENGTH) / len;
        const k = cur ? (hand0 ? cur.k + SIZE_EASE * (kWant - cur.k) : cur.k) : kWant;
        cur = { x: spot.x, y: spot.y, th: 0, k };
      }
      const at = { s: hand0?.s ?? H * 0.2 };
      if (!cur) cur = pictureTarget(pp, { w: [W * 0.5, H * 0.75], m: [W * 0.5, H * 0.5], s: H * 0.2 });
      const pulse = 0.5 + 0.5 * Math.sin(tMs / 160);

      // the finger to change: a faint glow on the learner's own finger, the goal dotted, and the golden finger gliding
      // from one to the other (drawn after the picture, below, so it is on top)
      let gold = null;
      if (landmarks && blocks.length) {
        const fingers = blocks.flatMap((b) => (b === "spread" ? ["index", "middle", "ring", "pinky"] : FINGER_POINTS[b] ? [b] : []));
        const P = landmarks.map((p) => [p.x * W, p.y * H]);
        const goal = templates?.[letter] ? goalFingers(templates[letter].pts, P, hand) : null;
        const lw = 0.2 * at.s;
        ctx.save();
        ctx.lineCap = ctx.lineJoin = "round";
        for (const f of fingers) {
          const mine = FINGER_POINTS[f].map((i) => P[i]);
          fingerPath(ctx, mine);
          ctx.strokeStyle = GOLD.glow; ctx.lineWidth = 1.5 * lw; ctx.stroke();
          if (goal) {
            fingerPath(ctx, goal[f]);
            ctx.setLineDash([0.12 * at.s, 0.12 * at.s]);
            ctx.strokeStyle = GOLD.fill; ctx.lineWidth = 0.06 * at.s; ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        ctx.restore();
        if (goal) gold = { fingers, P, goal, lw };
      }

      // the picture
      const t = transformOf(pp, cur);
      const img = green ? pics.match : turned ? pics.turn : pics.neutral;
      ctx.save();
      ctx.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
      ctx.globalAlpha = turned && !green ? 0.6 + 0.4 * pulse : LINE_ALPHA;
      // a soft dark edge so white lines still read on a white wall
      ctx.shadowColor = green ? "rgba(20, 83, 45, 0.9)" : "rgba(15, 23, 42, 0.8)";
      ctx.shadowBlur = 3;
      ctx.drawImage(img, 0, 0);
      ctx.restore();

      if (gold) {
        const { f: k, alpha } = journey(tMs);
        ctx.save();
        ctx.lineCap = ctx.lineJoin = "round";
        ctx.globalAlpha = alpha;
        for (const f of gold.fingers) {
          const from = FINGER_POINTS[f].map((i) => gold.P[i]);
          const now = from.map((q, j) => [q[0] + k * (gold.goal[f][j][0] - q[0]), q[1] + k * (gold.goal[f][j][1] - q[1])]);
          fingerPath(ctx, now);
          ctx.strokeStyle = GOLD.line; ctx.lineWidth = gold.lw + 0.07 * at.s; ctx.stroke();
          ctx.strokeStyle = GOLD.fill; ctx.lineWidth = gold.lw; ctx.stroke();
          // the fingertip, a little brighter, so the eye follows it
          const tip = now[now.length - 1];
          ctx.beginPath(); ctx.arc(tip[0], tip[1], 0.55 * gold.lw, 0, 2 * Math.PI);
          ctx.fillStyle = "rgba(254, 243, 199, 0.95)"; ctx.fill();
        }
        ctx.restore();
      }
    },
  };
}
