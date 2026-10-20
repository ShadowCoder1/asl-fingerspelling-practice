/* asl-demo.js: the ghost-hand demo (Indranil and JT, 19 Oct 2026, for a meeting with Duolingo).
 *
 * The practice part of the study -- the letter, its picture and description, the hold-still ring, the grader and
 * its one-thing-to-change hints -- with the letter's PICTURE laid over the learner's own hand on the camera view, at
 * their hand's size (experiments/asl-tutor/picture-ghost.js; ?look=hand shows instead the outline of a real hand as
 * the camera sees it, experiments/asl-tutor/ghost.js). It is live: while the hand moves, the finger the grader would
 * ask to change glows amber on the learner's hand, and the picture turns green the moment the grader would accept the
 * hand as it is (experiments/asl-tutor/coach.js).
 *
 * Nothing is saved, ever: this experiment refuses to run where config.js has Firebase settings (the study site), so
 * it can only run on the demo site or locally. No consent or questionnaire screens are shown by it either.
 *
 * URL: ?exp=asl-demo [&letters=BLYG...] (in that order; default A-Z) [&reps=n] (times through, default 1)
 *      [&hand=left] [&ghost=0] (start with the outline off) [&follow=1] (on the hand, not in a spot) [&look=picture|hand]
 *      [&dots=0] (hide the learner's skeleton) [&dots=1] (the tracked hand's dots too) [&srcmirror=1] [&debug=1]
 * Keys while practising: G shows or hides the ghost (to show the difference), N or -> skips to the next letter. */

import { flattenRounded, DECIMALS } from "../tutor/landmarks.js";
import { loadModel } from "../tutor/verifier.js";
import { loadOpenFS } from "../tutor/openfs.js";
import { LETTERS, pictureUrl } from "../tutor/letters.js";
import { createEngine, TUTOR_COMMIT_OPTS } from "./asl-tutor/engine.js";
import { mountTutor } from "./asl-tutor/ui.js";
import { createDebug } from "./asl-tutor/debug.js";
import { createGhost } from "./asl-tutor/ghost.js";
import { createPictureGhost } from "./asl-tutor/picture-ghost.js";
import { createCoach } from "./asl-tutor/coach.js";
import { createHandPicker, handSide } from "../tutor/pick-hand.js";
import { configLooksUnfilled } from "../js/core/firebase.js";

export const DEMO_VERSION = "asl-demo/1";
const MODEL_PATH = "tutor/model.json";
const GHOST_PATH = "tutor/ghost-hands.json";
const PICTURES_PATH = "tutor/ghost-pictures.json";
/* A letter stays up until it is made (or skipped): the tutor's own safety valve still ends it after five different
 * missed hands, so a letter the grader cannot see never traps anyone. */
const TRIAL_SEC = 300;
const OPENFS_WAIT_MS = 10000;

/* What the line under the letter says while the hand moves, for each look. */
export const LIVE_TEXT = Object.freeze({
  match: "That's it. Hold it still.",
  accepted: "",
  neutral: "Put your hand inside the outline.",
  orientation: "Turn your hand to match the outline.",
  spread: "Match the gaps between your fingers.",
  thumb: "Move your thumb where the gold one goes.",
  finger: (f) => `Move your ${f} finger where the gold one goes.`,
});
export function liveText(look) {
  if (!look) return LIVE_TEXT.neutral;
  if (look.state === "match") return LIVE_TEXT.match;
  if (look.state === "accepted") return LIVE_TEXT.accepted;
  if (look.state !== "fix" || !look.blocks.length) return LIVE_TEXT.neutral;
  const b = look.blocks[0];
  if (b === "orientation") return LIVE_TEXT.orientation;
  if (b === "spread") return LIVE_TEXT.spread;
  if (b === "thumb") return LIVE_TEXT.thumb;
  return LIVE_TEXT.finger(b);
}

/* Forgiving on purpose (a demo link gets typed and pasted): anything that is not a letter is ignored -- a full stop
 * pasted from the end of a sentence, spaces, commas. Only a link with no letters at all is refused. */
export function parseDemoLetters(raw) {
  if (raw === null || raw.trim() === "") return LETTERS.slice();
  const letters = raw.toUpperCase().split("").filter((c) => LETTERS.includes(c));
  if (!letters.length) throw new Error(`?letters=${raw} has no letters in it. Use A-Z, for example ?letters=BLFG.`);
  return letters;
}
export function parseDemoReps(raw) {
  if (raw === null || raw === "") return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error(`?reps=${raw} should be a whole number from 1 to 20.`);
  return n;
}
/** The letters in the order given, `reps` times through. */
export const demoPlan = (letters, reps) => Array.from({ length: reps }, (_, r) => letters.map((letter) => ({ letter, pass: r }))).flat();

const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const HAND = params.get("hand") === "left" ? "left" : "right";
const debugOn = params.get("debug") === "1";
/* What is drawn for the hand to fit: the letter's picture SCHEMATIZED to its clean outline (default; Indranil, 19 Oct:
 * "more of a schematized outline (no details like knuckles)", so a right hand's skeleton sits inside it); ?look=picture,
 * the whole picture; ?look=hand, the outline of a real hand (experiments/asl-tutor/ghost.js). */
const LOOK_STYLE = ["picture", "hand"].includes(params.get("look")) ? params.get("look") : "outline";
// The picture stays in one spot for the hand to fit into (the owner, 19 Oct); ?follow=1 puts it on the hand instead.
const FOLLOW = params.get("follow") === "1";
// the learner's own tracked skeleton, to compare with the outline (Indranil, 19 Oct: "retain the hand skeleton");
// ?dots=0 hides it
const DOTS = params.get("dots") !== "0";

let session = null, view = null, debug = null, mountError = null, picker = null;
let openfsReady = null, openfsPromise = null;
function startOpenFS() {
  openfsPromise ??= loadOpenFS().then((o) => { openfsReady = o; return o; }).catch((err) => {
    console.warn(`asl-demo: OpenFS not loaded, grading without its second opinion (${err?.message || err})`);
    return null;
  });
  return openfsPromise;
}

export default {
  id: "asl-demo",
  title: "Fingerspelling practice with a ghost hand",
  tracker: "hand",
  trackerOptions: { numHands: 2 },
  pickHand(res, { aspect }) {
    picker ??= createHandPicker(HAND);
    return picker(res, aspect);
  },
  /* The camera check lets only the asked-for hand through (as the study's does). A camera that sends a mirror image
   * makes a right hand look like a left one, and nothing would ever be accepted: so it also offers to flip it. */
  handProblem(res, k, { aspect }) {
    const side = handSide(res.landmarks[k], res.handedness?.[k], aspect);
    const wrong = side && side !== HAND;
    showFlipOffer(wrong);
    return wrong ? `That looks like your ${side} hand. Please hold up your ${HAND} hand.` : null;
  },

  maxTrials: (() => { try { return demoPlan(parseDemoLetters(params.get("letters")), parseDemoReps(params.get("reps"))).length; } catch { return 26; } })(),
  demographicQuestions: [],
  postQuestions: [],
  showInstructions: true,
  positionText: () => `Hold up your ${HAND} hand in front of the camera. When we can see it clearly, the button below will turn on.`,
  instructions: () => `
    <p><strong>Fingerspell each letter with your ${HAND} hand.</strong> The letter's picture is on the right, and the same
       picture is drawn in the camera view, sized to your hand: put your hand into it, turned and shaped to fit.</p>
    <ul class="demo-legend-list">
      <li><span class="demo-chip demo-chip-neutral"></span> Fit your hand into the picture.</li>
      <li><span class="demo-chip demo-chip-fix"></span> A gold finger shows which finger to move, and where to.</li>
      <li><span class="demo-chip demo-chip-match"></span> Green: that's the letter. Hold still until the circle fills.</li>
    </ul>
    <p class="subtle">Keys: <kbd>G</kbd> shows or hides the outline, <kbd>N</kbd> skips to the next letter. Nothing is recorded or saved.</p>`,

  mount(el) {
    let letters = LETTERS.slice(), reps = 1;
    try {
      if (!configLooksUnfilled()) throw new Error("The ghost-hand demo saves nothing, so it runs only on the demo site, not where the study saves data.");
      letters = parseDemoLetters(params.get("letters"));
      reps = parseDemoReps(params.get("reps"));
    } catch (err) {
      mountError = err;
    }
    session = { letters, reps, plan: demoPlan(letters, reps), model: null, engine: null, ghost: null, coach: null,
      ghostOn: params.get("ghost") !== "0", endTrial: null, trial: null, look: null, results: [] };
    view = mountTutor(el, { letters, hintPolicy: "strict", layout: "study", hand: HAND });
    /* ONE line of words under the letter (ui.js shows the status line only while there is no feedback): the ghost's
     * live line, except for a moment after the tutor itself says something ("I keep losing your hand"; renderLine).
     * A correction from the last hold gives way to it (FEEDBACK_HOLD_MS), so the two never contradict each other. */
    session.statusNode = el.querySelector("#tutor-status");
    session.feedbackNode = el.querySelector("#tutor-feedback");
    session.tutorStatus = "";
    const cue = view.cue.bind(view), feedback = view.feedback.bind(view);
    view.status = (text) => {
      // "Hold still when you have the shape" is what the ghost's own line already says, better; the rest are shown
      session.tutorStatus = text === MOVED_LINE ? "" : text || "";
      session.tutorStatusAt = performance.now();
      renderLine();
    };
    view.cue = (e) => { cue(e); session.tutorStatus = ""; session.feedbackAt = null; renderLine(); };
    view.feedback = (e, letter) => { feedback(e, letter); session.feedbackAt = e.tone === "correction" ? performance.now() : null; };
    el.querySelector(".tutor-panel")?.insertAdjacentHTML("beforeend", `
      <div class="demo-legend" id="demo-legend">
        <span><span class="demo-chip demo-chip-neutral"></span>the shape to make</span>
        <span><span class="demo-chip demo-chip-you"></span>your hand</span>
        <span><span class="demo-chip demo-chip-fix"></span>change this</span>
        <span><span class="demo-chip demo-chip-match"></span>that's it</span>
        <span class="demo-keys"><kbd>G</kbd> outline <span id="demo-ghost-state">on</span> · <kbd>N</kbd> next letter</span>
      </div>`);
    session.ghostState = el.querySelector("#demo-ghost-state");
    session.ghostState.textContent = session.ghostOn ? "on" : "off";
    if (debugOn) debug = createDebug(el, { getModel: () => session.model, canSave: false });
    document.addEventListener("keydown", onKey);
    // the platform's end-of-demo download button and its note are for researchers, not for this page
    document.documentElement.classList.add("asl-demo");
    startOpenFS();
  },

  async nextTrial(index) {
    if (mountError) throw mountError;
    if (index === 0) await loadEverything();
    const step = session.plan[index];
    if (!step) return null;
    return {
      id: `d${String(index + 1).padStart(3, "0")}_${step.letter}`, letter: step.letter, kind: "teach", pass: step.pass,
      durationSec: TRIAL_SEC, countdownSec: 0, skipRest: true, backgroundUpload: false,
    };
  },

  onTrialStart(trial, { tracker }) {
    session.engine.startTrial(trial);
    session.coach.reset();
    session.ghost.reset();
    session.picture.reset();
    session.trial = trial;
    session.look = null;
    setLive(null);
    debug?.trialStart(trial);
    return { tracker, addEvent: null, overlay: true };
  },

  onFrame({ landmarks, handedness, handednessScore, tMs, trial, video, addEvent, endTrial }) {
    session.endTrial = endTrial;
    const flat = landmarks ? flattenRounded(landmarks, DECIMALS) : null;
    const out = session.engine.frame({ tMs, flat, aspect: video.aspect, videoHeight: video.height, handedness });
    view.progress(out.progress);
    view.paused(out.paused);
    const look = session.coach.update({ flat, aspect: video.aspect, videoHeight: video.height }, trial.letter, tMs);
    applyEffects(out.effects, { trial, addEvent, endTrial });
    if (session.look !== session.coach.look) setLive(session.coach.look);
    session.look = session.coach.look ?? look;
    renderLine();
    debug?.frame({ flat, handedness, handednessScore, trial, videoInfo: video, committerState: session.engine.committerState, progress: out.progress });
    return { progress: Math.round(out.progress * 1000) / 1000 };
  },

  // the ghost; the learner's own tracked hand on top of it only with ?dots=1 (or with the ghost off, so they can see
  // they are tracked)
  draw(ctx, { landmarks, canvas, trial }) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (session?.ghostOn && session.ghost && trial) {
      if (LOOK_STYLE !== "hand" && session.picture.has(trial.letter)) {
        session.picture.draw(ctx, canvas, landmarks, trial.letter, session.look, performance.now());
      } else {
        session.ghost.draw(ctx, canvas, landmarks, trial.letter, HAND, 1, session.look, performance.now());
      }
    }
    if (DOTS || !session?.ghostOn) drawHand(ctx, canvas, landmarks);
  },

  onTrialEnd({ endReason }) {
    session.engine.finishTrial(endReason);
    const s = session.engine.summary();
    const row = { letter: s.letter, kind: "teach", outcome: s.outcome ?? null, attempts: s.attempts, correct: s.outcome === "accept", endReason };
    session.results.push(row);
    return row;
  },

  renderResults(summaries) {
    const got = summaries.filter((s) => s.correct).length;
    return `<p><strong>${got} of ${summaries.length} letters made.</strong></p>
      <p><a class="demo-again" href="${location.href}">Practice again</a></p>
      <p class="subtle">Research prototype. Grading is approximate and based on public data — it can be wrong. Hands are read
      with MediaPipe (Google) and OpenFS (KETI), used here for non-commercial research. Nothing was saved.</p>`;
  },
};

/* Under the camera check: "My camera shows me flipped", which reloads with ?srcmirror=1 (js/core/tracker.js) toggled. */
let flipOffer = null;
function showFlipOffer(on) {
  if (typeof document === "undefined") return;
  if (!flipOffer) {
    const status = document.querySelector("#position-status");
    if (!status) return;
    flipOffer = document.createElement("p");
    flipOffer.className = "demo-flip";
    const q = new URLSearchParams(location.search);
    const mirrored = q.get("srcmirror") === "1";
    if (mirrored) q.delete("srcmirror"); else q.set("srcmirror", "1");
    flipOffer.innerHTML = `Using your ${HAND} hand already? Your camera may flip the picture:
      <a href="?${q.toString()}">${mirrored ? "undo the flip" : "fix it"}</a>.`;
    status.after(flipOffer);
  }
  flipOffer.hidden = !on;
}

function onKey(e) {
  if (e.target?.closest?.("input, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "g") {
    session.ghostOn = !session.ghostOn;
    session.ghostState.textContent = session.ghostOn ? "on" : "off";
    setLive(session.look);
  } else if ((k === "n" || e.key === "ArrowRight") && session.endTrial && document.querySelector("#screen-trial.visible")) {
    session.endTrial("skipped");
  }
}

/* A correction from the last hold stays up this long, then gives way to the ghost's live line, so the two never sit
 * side by side saying different things; a green ghost clears it at once ("that is a different sign" under a green
 * ghost would contradict it). "Good job" is never cleared. */
export const FEEDBACK_HOLD_MS = 2500;
function setLive(look) {
  if (session?.statusNode) renderLine(look);
}

/* What the tutor itself says (the hand is too small or keeps being lost, the hand has not let go of the last
 * letter, the same shape again, how to draw a J or Z) is shown for TUTOR_LINE_MS, then the ghost's line comes back;
 * on J and Z (no live grading) the tutor's line stays. */
export const TUTOR_LINE_MS = 2500;
const MOVED_LINE = "Hold still when you have the shape.";
function renderLine(look = session.look) {
  const n = session.statusNode;
  if (session.feedbackAt != null && session.ghostOn && (look?.state === "match" || performance.now() - session.feedbackAt >= FEEDBACK_HOLD_MS)) {
    session.feedbackNode.textContent = "";
    session.feedbackNode.className = "tutor-feedback";
    session.feedbackAt = null;
  }
  const motion = session.trial && "JZ".includes(session.trial.letter);
  let text, state;
  if (session.tutorStatus && (motion || performance.now() - session.tutorStatusAt < TUTOR_LINE_MS)) {
    text = session.tutorStatus; state = "tutor";
  } else if (!session.ghostOn) {
    text = "Copy the picture, then hold your hand still."; state = "tutor";
  } else {
    text = liveText(look); state = look?.state ?? "neutral";
  }
  if (n.textContent !== text) n.textContent = text;
  if (n.dataset.state !== state) n.dataset.state = state;
}

async function loadEverything() {
  const get = async (path, what) => {
    try {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      throw new Error(`Could not load the ${what} from ${path} (${err?.message || err}).`);
    }
  };
  const [model, ghosts, pictures] = await Promise.all([get(MODEL_PATH, "grading model"), get(GHOST_PATH, "ghost hands"),
    get(PICTURES_PATH, "picture points")]);
  session.model = loadModel(model);
  session.ghost = createGhost(ghosts.letters);
  session.picture = createPictureGhost({ points: pictures.letters, templates: ghosts.letters, hand: HAND, follow: FOLLOW,
    style: LOOK_STYLE === "picture" ? "picture" : "outline" });
  if (LOOK_STYLE !== "hand") await session.picture.load(session.letters, pictureUrl);
  session.coach = createCoach(session.model, { hand: HAND });
  let timer;
  await Promise.race([startOpenFS(), new Promise((r) => { timer = setTimeout(r, OPENFS_WAIT_MS); })]);
  clearTimeout(timer);
  // EXACTLY the study's practice: its ring (0.9 s still), its grader, its hints. (The first demo used the expert ring,
  // 1.5 s after a 0.5 s settle: on the same real footage it took 10 letters where the study's practice took 16, and
  // Indranil and the owner both struggled to get to the next letter, 19 Oct.)
  session.engine = createEngine({ model: session.model, letters: session.letters, hintPolicy: "strict", gradeAll: true, hand: HAND,
    commitOpts: TUTOR_COMMIT_OPTS, mix: { getOpenFS: () => openfsReady } });
}

function applyEffects(effects, { trial, addEvent, endTrial }) {
  for (const e of effects) {
    switch (e.kind) {
      case "cue": view.cue(e); break;
      case "feedback":
        view.feedback(e, trial.letter);
        if (e.tone === "correct") { session.coach.accepted(); setLive(session.coach.look); }
        break;
      case "status": view.status(e.text); break;
      case "reward": view.reward(e.points); break;
      case "complete": view.complete(); break;
      case "log": if (e.event === "attempt") debug?.attempt(e.data); addEvent?.(e.event, e.data); break;
      case "end-trial": endTrial(e.reason); break;
      default: break;
    }
  }
}

const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
/* The learner's tracked hand: a sky-blue skeleton with white joints, over the outline, so the two can be told apart
 * (js/core/experiment.js drawLandmarks would clear the outline away). */
function drawHand(ctx, canvas, lm) {
  if (!lm || lm.length !== 21) return;
  const W = canvas.width, H = canvas.height, s = Math.max(1.8, H / 300);
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(56, 189, 248, 0.95)";
  ctx.lineWidth = s;
  ctx.beginPath();
  for (const [a, b] of BONES) { ctx.moveTo(lm[a].x * W, lm[a].y * H); ctx.lineTo(lm[b].x * W, lm[b].y * H); }
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  for (const p of lm) { ctx.beginPath(); ctx.arc(p.x * W, p.y * H, 1.6 * s, 0, 2 * Math.PI); ctx.fill(); }
  ctx.restore();
}
