/* Ego2Real site interactions */

/* ---------- reveal on scroll ---------- */
const io = new IntersectionObserver((es) => {
  es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

/* ---------- the spine ---------- */
(function () {
  const host = document.getElementById('spine');
  if (!host) return;
  const svg = host.querySelector('svg');
  const NS = 'http://www.w3.org/2000/svg';
  const routes = [
    'M17,0 L17,300 C17,340 5,340 5,380 L5,620 C5,660 17,660 17,700 L17,1000',
    'M17,0 L17,300 C17,340 29,340 29,380 L29,620 C29,660 17,660 17,700 L17,1000'
  ];
  const paths = routes.map(d => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d); p.setAttribute('class', 'prog');
    svg.insertBefore(p, svg.querySelector('.dot'));
    const L = p.getTotalLength();
    p.style.strokeDasharray = L; p.style.strokeDashoffset = L;
    return { p, L };
  });
  document.getElementById('spineProg').remove();
  const dot = document.getElementById('spineDot');

  function tick() {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    const f = Math.min(1, Math.max(0, window.scrollY / (h || 1)));
    paths.forEach(({ p, L }) => { p.style.strokeDashoffset = L * (1 - f); });
    const pt = paths[0].p.getPointAtLength(paths[0].L * f);
    dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y);
  }
  addEventListener('scroll', tick, { passive: true });
  addEventListener('resize', tick);
  tick();
})();

/* ---------- pipeline stage detail ---------- */
const STAGES = {
  ingest: {
    t: 'Ingest and screening',
    d: 'Clips are screened for a visible manipulation, packaged with their license, and given a stable identifier that every later stage writes into. Every artifact of a package lives under one directory, so a rerun of one stage is a surgical operation.',
    c: ['license screening', 'package layout', 'schema validator']
  },
  perceive: {
    t: 'Perception stack',
    d: 'Four models read the clip. A hand estimator returns twenty-one keypoints and a wrist frame. A video segmenter tracks the hand and the task object with prompt propagation. A monocular depth model returns relative inverse depth, which a least-squares fit converts to metric using the hand keypoints as the scale anchor. A point tracker recovers camera motion, with an optical-flow fallback.',
    c: ['WiLoR hands', 'SAM 2.1 masks', 'Depth Anything V2', 'CoTracker2 camera', 'metric scale fit']
  },
  trace: {
    t: 'The canonical 4D trace',
    d: 'Everything is back-projected into one gravity-aligned metric frame anchored at the workbench, with the camera trajectory explicit. Hand keypoints are re-projected through the scene intrinsics so that hand points and object points share one mapping, which is what makes a proximity test meaningful. The contact state machine then labels every frame, and episode-level contact events are rebuilt from it.',
    c: ['gravity aligned', 'metric', 'camera explicit', 'contact events first-class']
  },
  inpaint: {
    t: 'Remove the human',
    d: 'The hand masks and a forearm corridor are dilated and inpainted. The high-fidelity path additionally recovers a temporal median background plate from the frames where each pixel was unoccluded, stabilized by a homography to the middle frame, which removes the ghost of the hand rather than smearing it.',
    c: ['mask union', 'forearm corridor', 'temporal median plate']
  },
  compose: {
    t: 'Two-pass differential occlusion',
    d: 'The twin is rendered twice with identical camera and lighting, differing only in whether the robot geometry is visible. The difference of the two passes is the exact robot mask, including occlusion by real objects. A one and a half pixel feather gives sub-pixel edges. Nothing is hallucinated, so the geometry stays exactly the forward kinematics of the executed trajectory.',
    c: ['background pass', 'robot pass', 'exact alpha', 'sub-pixel feather']
  },
  hifi: {
    t: 'High-fidelity rendering',
    d: 'Deterministic upgrades only: two times supersampling, soft shadows from a separate appearance pass, studio key lighting, material enhancement, and a color harmonization that matches the robot statistics to the ring of real pixels around it. Three feature encoders agree that the result is closer to real footage, while cycle consistency holds.',
    c: ['supersample', 'soft shadows', 'harmonization', 'geometry untouched']
  },
  retarget: {
    t: 'Contact-anchored retarget',
    d: 'A quadratic program solves inverse kinematics with a frame task on the end effector, a posture task toward home, and joint limits. The base is placed by a search over reachability. On grasp frames the contact-anchored arm overrides the target with the contact points from the trace, aligns the jaw with the thumb-to-index axis, and locks the gripper. A pre-grasp ramp blends toward the contact eight frames early.',
    c: ['MINK inverse kinematics', 'reach-aware base', 'pre-grasp ramp', 'grasp override']
  },
  refine: {
    t: 'Refinement in the digital twin',
    d: 'Replay servos the reference in a twin rebuilt from the same scene. Chunks that already track the object are committed for free, which saved a quarter of the sampling budget. The rest go to a receding-horizon sampler with time-correlated noise, scored on tracking, contact inside the grasp interval, and the absence of contact outside it. The reference is always candidate zero.',
    c: ['MuJoCo twin', 'twenty-frame chunks', 'free commit', 'spurious contact penalty']
  },
  rl: {
    t: 'Whole-horizon residual policy',
    d: 'A small network adds a bounded residual to every reference action, conditioned on the tracking error, the grasp flag and the phase. It is trained by evolution strategies, because the twin reward contains contact switches and early termination. A tightness knob separates the reward boundary from the simulator boundary, which forces the policy to track tighter than the simulator demands. Zero parameters reproduce replay exactly, so the ladder can only improve.',
    c: ['bounded residual', 'evolution strategies', 'binary success reward', 'tightness knob']
  },
  qc: {
    t: 'Quality gate and repair',
    d: 'Six dimensions, four of them measured by executing the trajectory. A weighted score with a required set produces a pass, marginal or fail verdict, and the failing dimension names a repair action: relax the grasp orientation, re-place the base, spend more sampling budget, re-trace with looser contact thresholds, or re-render with a recalibrated camera. Only the affected stages rerun, the package is rescored, and the first attempt that improves the verdict is kept.',
    c: ['execution verified', 'failure dimension', 'targeted rerun', 'restore on failure']
  },
  export: {
    t: 'Export with a quality token',
    d: 'Frame-level entries carry the robotized video reference, the executed joint state, the next-state action, the language instruction, and a scalar quality token. Marginal packages ship with a lower token rather than being deleted, and the policy reads that token as an input. Stale exports are pruned whenever a verdict changes, so the dataset always equals the current verdict.',
    c: ['frame-level entries', 'quality token', 'stale export pruning']
  },
  policy: {
    t: 'Policy training and closed-loop evaluation',
    d: 'A 28 M parameter flow-matching visuomotor policy trains on the exported entries with an episode-level held-out split. Evaluation drives the same twin from which the data came, in the pixel domain the policy was trained on, with paired noise seeds across arms. The pre-registered primary metric is the interaction-gated success rate.',
    c: ['flow matching', 'twenty-step chunks', 'closed-loop twin rollout', 'interaction-gated success']
  }
};
(function () {
  const box = document.getElementById('pipeDetail');
  const nodes = document.querySelectorAll('.node');
  nodes.forEach(n => n.addEventListener('click', () => {
    const k = n.dataset.k, s = STAGES[k];
    const open = n.getAttribute('aria-expanded') === 'true';
    nodes.forEach(m => m.setAttribute('aria-expanded', 'false'));
    if (open) {
      box.innerHTML = '<div class="dt">Select a stage</div><div class="dd">Nine stages, one trace. The visual branch renders the robot at the forward kinematics of the trajectory the action branch produced, so the two outputs describe the same robot by construction.</div>';
      return;
    }
    n.setAttribute('aria-expanded', 'true');
    box.innerHTML = '<div class="dt">' + s.t + '</div><div class="dd">' + s.d + '</div><div class="chips">' +
      s.c.map((c, i) => '<span class="chip' + (i === s.c.length - 1 ? ' c' : '') + '">' + c + '</span>').join('') + '</div>';
  }));
})();

/* ---------- contact state machine ---------- */
const FSM = {
  free: { r: 'The hand is far from the object. Nothing is required of the gripper, and the trajectory is a free-space move.', e: 'Proximity above 12 cm.' },
  approach: { r: 'The hand is closing in. The pre-grasp ramp starts here: the retarget target begins blending from the wrist pose toward the contact points, eight frames before the grasp.', e: 'Proximity below 12 cm, with no touch yet.' },
  touch: { r: 'Contact without force closure. A finger rests on the object, and the object stays where it is. This is a real state and it is distinct from a grasp.', e: 'Proximity below 1.5 cm, entering. Exit needs 3.5 cm, so the state survives depth noise.' },
  grasp: { r: 'Force closure. The gripper is locked shut, the target is the contact point centroid, and the jaw axis is aligned with the thumb-to-index direction. Every downstream stage treats these frames as the ones that must be right.', e: 'Touch, plus a closed aperture, plus hand and object moving together.' },
  release: { r: 'The single frame where contact ends. It bounds the contact event, and it tells the gripper when to open.', e: 'Proximity leaves the exit threshold after a touch or a grasp.' }
};
(function () {
  const out = document.getElementById('fsmOut');
  const btns = document.querySelectorAll('.fsm button');
  function show(s) {
    out.innerHTML = '<div class="r">' + FSM[s].r + '</div><p class="cap" style="margin-top:10px"><strong>Trigger.</strong> ' + FSM[s].e + '</p>';
  }
  btns.forEach(b => b.addEventListener('click', () => {
    btns.forEach(x => x.classList.remove('on'));
    b.classList.add('on'); show(b.dataset.s);
  }));
  show('free');
})();

/* ---------- refinement ladder chart ---------- */
(function () {
  const C = ['0.50', '0.40', '0.30', '0.25', '0.20'];
  const D = {
    replay: [0.25, 0.25, 0.25, 0.00, 0.00],
    mpc: [0.50, 0.50, 0.25, 0.00, 0.00],
    rl: [0.50, 0.50, 0.50, 0.25, 0.00]
  };
  const NOTE = [
    'A loose boundary flatters everyone. The sampler already reaches its ceiling, and the residual policy has nothing left to win.',
    'Still loose. Replay stays behind, and the two upper rungs are tied.',
    'The boundary bites. The residual policy holds twice the success of the sampler, because whole-horizon credit assignment smooths the contact transitions that a chunked sampler leaves behind.',
    'Tighter still. The residual policy is the only rung that recovers an episode here, and both lower rungs are at zero.',
    'Beyond the reach of every rung. Two of the four episodes carry a reference the parallel jaw cannot hold, which is a hardware ceiling rather than a control one.'
  ];
  const S = 0.58;
  const el = id => document.getElementById(id);
  const sl = el('cSlider');
  function draw() {
    const i = +sl.value;
    el('cVal').textContent = C[i];
    [['replay', 'barReplay', 'valReplay'], ['mpc', 'barMpc', 'valMpc'], ['rl', 'barRl', 'valRl']].forEach(([k, b, v]) => {
      const x = D[k][i];
      el(b).style.width = (x / S * 100) + '%';
      el(v).textContent = x.toFixed(2);
    });
    el('cNote').textContent = NOTE[i];
  }
  sl.addEventListener('input', draw);
  const co = new IntersectionObserver(es => { if (es[0].isIntersecting) { draw(); co.disconnect(); } }, { threshold: .3 });
  co.observe(document.querySelector('.chart'));
})();

/* ---------- before / after slider ---------- */
(function () {
  const ba = document.getElementById('ba');
  if (!ba) return;
  const after = ba.querySelector('.after'), handle = ba.querySelector('.handle'), img = ba.querySelector('img');
  function size() { ba.style.setProperty('--baw', ba.clientWidth + 'px'); }
  function set(x) {
    const r = ba.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (x - r.left) / r.width));
    after.style.width = (p * 100) + '%';
    handle.style.left = (p * 100) + '%';
  }
  let down = false;
  ba.addEventListener('pointerdown', e => { down = true; ba.setPointerCapture(e.pointerId); set(e.clientX); });
  ba.addEventListener('pointermove', e => { if (down) set(e.clientX); });
  ba.addEventListener('pointerup', () => { down = false; });
  addEventListener('resize', size);
  if (img.complete) size(); else img.addEventListener('load', size);
})();

/* ---------- gallery lightbox ---------- */
(function () {
  const lb = document.getElementById('lb'), v = document.getElementById('lbv'),
    t = document.getElementById('lbt'), s = document.getElementById('lbs'), x = document.getElementById('lbx');
  if (!lb) return;
  function open(src, tt, ss) {
    v.src = src; t.textContent = tt; s.textContent = ss;
    lb.classList.add('on'); v.play().catch(() => {});
  }
  function close() { lb.classList.remove('on'); v.pause(); v.removeAttribute('src'); v.load(); }
  document.querySelectorAll('.gclip').forEach(c =>
    c.addEventListener('click', () => open(c.dataset.src, c.dataset.t, c.dataset.s)));
  x.addEventListener('click', close);
  lb.addEventListener('click', e => { if (e.target === lb) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && lb.classList.contains('on')) close(); });
})();

/* ---------- repair feedback loop ---------- */
(function () {
  const btn = document.getElementById('repairBtn');
  const log = document.getElementById('repairLog');
  const y = document.getElementById('yieldVal');
  const pkg = id => document.querySelector('.pkg[data-id="' + id + '"]');
  const steps = [
    { id: '163', v: 'marginal', st: 'diagnosing', msg: 'brush 163 fails on retarget feasibility. The gate names the dimension, and the dimension names the action: relax the grasp orientation.' },
    { id: '163', v: 'pass', st: 'pass', msg: 'brush 163 repaired. Feasibility rises from 0.554 to 0.893 and the verdict lifts to pass. A base replacement was attempted first, correctly failed to help, and was restored automatically, so the credit belongs to the diagnosis rather than to random search.' },
    { id: '019', v: 'fail', st: 'diagnosing', msg: 'stir 019 fails on contact consistency. The action is a re-trace with relaxed contact thresholds, which reruns the trace and everything downstream of it.' },
    { id: '019', v: 'marginal', st: 'marginal', msg: 'stir 019 lifts from fail to marginal on the first round, and it ships with a lower quality token rather than being deleted.' },
    { id: '202', v: 'marginal', st: 'diagnosing', msg: 'stir 202 fails on rollout score. Four escalating attempts follow: more sampling, more iterations, longer lookahead, finer chunks.' },
    { id: '202', v: 'unrep', st: 'unrepairable', msg: 'stir 202 improves on none of them. It is marked unrepairable, the baseline is restored, and the diagnosis stands: the ceiling is the primitive geometry of the twin rather than the control budget. Strict pass yield doubles, and everything that entered the gate still ships.' }
  ];
  const yields = ['25%', '50%', '50%', '50%', '50%', '50%'];
  btn.addEventListener('click', () => {
    btn.disabled = true; btn.textContent = 'Repairing';
    steps.forEach((s, i) => setTimeout(() => {
      const p = pkg(s.id);
      p.dataset.v = s.v;
      p.querySelector('.st').textContent = s.st;
      log.textContent = s.msg;
      y.textContent = yields[i];
      if (i === steps.length - 1) { btn.textContent = 'Repair complete'; }
    }, 1100 * (i + 1)));
  });
})();
