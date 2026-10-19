/* coach.js: what the ghost hand says, live, on every frame (experiments/asl-tutor/ghost.js draws it).
 *
 * The ring still decides: a hand is graded when it is held still (tutor/commit.js), exactly as without the ghost.
 * The coach only LOOKS, frame by frame, with the same grader and the same blame the hold will get -- so what the
 * ghost shows while the learner is still moving is what the hold would be told:
 *
 *   match   the grader would accept this hand as it is right now (tutor/mix.js's P and O/E rules; the OpenFS second
 *           opinion reads a whole hold, so it only ever adds an acceptance at the hold)
 *   fix     it would not, and the grader's blame (tutor/blame.js chooseCorrection: the one or two articulators whose
 *           correction alone would make the grader accept) names what to change: a finger, the thumb, the spread
 *           between the fingers, or the orientation
 *   neutral nothing to say: no hand, a hand the camera cannot read well, a hand so far off that no one or two
 *           corrections would do (the picture is the help then), or a movement letter (J, Z)
 *
 * It judges the median of the last few frames, as the hold is graded, and a look is shown only once it has held for
 * SETTLE_MS ("match" a little sooner), so the ghost does not flicker while the hand is on its way into a shape.
 * Looking changes nothing the tutor does. */

import { toPoints } from "../../tutor/landmarks.js";
import { chirality, palmSize } from "../../tutor/hand-frame.js";
import { featuresFromFlat } from "../../tutor/features.js";
import { verify, standardize } from "../../tutor/verifier.js";
import { chooseCorrection } from "../../tutor/blame.js";
import { createMixedVerify, middleFingerDown, tipToKnuckle, NOT_E } from "../../tutor/mix.js";
import { MOTION_LETTERS } from "../../tutor/motion.js";
import { isCentered } from "./engine.js";

export const SETTLE_MS = 220;
export const MATCH_SETTLE_MS = 120;
const HAND_SIGN = { right: 1, left: -1 };
const FINGERS4 = ["index", "middle", "ring", "pinky"];

/** What the grader and its blame say about one frame, for the ghost. Pure. */
export function judgeFrame(model, { flat, aspect, videoHeight }, letter, hand = "right") {
  if (MOTION_LETTERS.includes(letter) || !(letter in model.index)) return { state: "neutral", blocks: [], why: "movement" };
  if (!flat || flat.some((v) => !Number.isFinite(v))) return { state: "neutral", blocks: [], why: "no-hand" };
  const points = toPoints(flat, aspect);
  const sign = HAND_SIGN[hand] ?? 1;
  const x = featuresFromFlat(flat, aspect, sign);
  const quality = {
    handPresentFrac: 1, palmSizePx: palmSize(points) * videoHeight, centered: isCentered(flat), chiralityMargin: chirality(points).margin,
  };
  const mixed = createMixedVerify({ verify, getOpenFS: () => null, getCommit: () => ({ flat, aspect }) });
  const v = mixed(model, x, letter, quality, { ignoreTier: true });
  if (v.outcome === "accept") return { state: "match", blocks: [] };
  if (v.reason === "tracking" || v.reason === "not-gradable") return { state: "neutral", blocks: [], why: v.reason };
  const z = standardize(model, x);
  if (!z.every(Number.isFinite)) return { state: "neutral", blocks: [], why: "not-gradable" };
  const c = chooseCorrection(model, z, letter);
  if (c.nothingToSay) {
    // the plain grader accepts it, one of mix.js's rules does not: say which way the rule points
    if (letter === "P" && !middleFingerDown(flat, aspect)) return { state: "fix", blocks: ["orientation"] };
    if (letter === "E" && tipToKnuckle(flat, aspect) >= NOT_E.minTipToKnuckle) return { state: "fix", blocks: FINGERS4 };
    return { state: "neutral", blocks: [], why: "rule" };
  }
  if (c.blocks.length) return { state: "fix", blocks: c.blocks.slice() };
  return { state: "neutral", blocks: [], why: "whole-shape" };
}

const same = (a, b) => a.state === b.state && a.blocks.join() === b.blocks.join();

/* The hold is graded on the median of its last WINDOW tracked frames (tutor/commit.js), so the coach judges the same
 * thing: the median of the hand's last WINDOW frames (no older than WINDOW_MS). Judging single frames, the ghost was
 * green at the end of 8.9% of the real holds that were then rejected (tools/ghost-hands/coach_eval.mjs). */
export const WINDOW = 7;
export const WINDOW_MS = 400;
export function medianFlat(rows) {
  const out = new Array(rows[0].length);
  const v = new Array(rows.length);
  for (let j = 0; j < out.length; j++) {
    for (let i = 0; i < rows.length; i++) v[i] = rows[i][j];
    v.sort((a, b) => a - b);
    const m = v.length >> 1;
    out[j] = v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  return out;
}

/** One per session: judges the median of the last few frames and smooths the result over time. `accepted()` turns
 * the ghost green until the next trial. */
export function createCoach(model, { hand = "right", settleMs = SETTLE_MS, matchSettleMs = MATCH_SETTLE_MS, window = WINDOW, windowMs = WINDOW_MS } = {}) {
  let shown = { state: "neutral", blocks: [] };
  let candidate = null, since = 0, done = false, recent = [];
  return {
    reset() { shown = { state: "neutral", blocks: [] }; candidate = null; done = false; recent = []; },
    accepted() { done = true; shown = { state: "accepted", blocks: [] }; },
    get look() { return shown; },
    update(frame, letter, tMs) {
      if (done) return shown;
      const ok = frame.flat && frame.flat.every(Number.isFinite);
      if (ok) {
        recent.push({ tMs, flat: frame.flat });
        while (recent.length > window || (recent.length && recent[0].tMs < tMs - windowMs)) recent.shift();
      } else {
        recent = [];
      }
      const flat = recent.length ? (recent.length === 1 ? recent[0].flat : medianFlat(recent.map((r) => r.flat))) : null;
      const now = judgeFrame(model, { ...frame, flat }, letter, hand);
      if (same(now, shown)) { candidate = null; return shown; }
      if (!candidate || !same(now, candidate)) { candidate = now; since = tMs; }
      if (tMs - since >= (now.state === "match" ? matchSettleMs : settleMs)) { shown = now; candidate = null; }
      return shown;
    },
  };
}
