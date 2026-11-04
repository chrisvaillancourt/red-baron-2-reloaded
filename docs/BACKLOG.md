# Task contracts and execution evidence

Current work (Now and Next) lives only in
[STATUS.md](STATUS.md). This file holds contracts, operating policy and revisioned
evidence—not another live queue. The original cycle base was
`07dfaa462a098df633e512a86406b9d7c416fc73`; dated measurements below keep their own refs.

Durable external blockers and untriggered historical ideas live in
[DEFERRED-TODOS](DEFERRED-TODOS.md); compact orchestration/pending designs live in
[IMPLEMENTATION-NOTES](IMPLEMENTATION-NOTES.md). Neither is a second ready queue.

## Operating decisions

- Check STATUS Now/Next and confirm claims in git or CI before dispatch; this file does not override STATUS.
- Work-in-progress limits are in AGENTS.md "Work in progress".
- Use isolated workspaces and exact base SHAs. One owner for each shared production file; freeze pursuer/damage policy during tactics comparisons. One exclusive GPU verification slot.
- Ready work requires observable acceptance and satisfied prerequisites. Blocked work names its unblock condition; deferred work names a trigger or date.
- Prioritize release safety, reproduced player problems, enabling work, repeated friction, then conditional polish. Refactor locally where duplicated knowledge is already causing errors; do not build speculative frameworks.
- Record committed, reviewed, integrated, deployed and release-verified separately. No task-branch handoff implies deployment.
- Baseline numbers identify commit, seeds/settings, cohort and command. Same-SHA A/B runs establish reproducibility, not improvement. CPU surveys do not replace human ratings or actual-browser evidence.

History, receipts, run logs and closed items moved verbatim to
[BACKLOG-ARCHIVE](BACKLOG-ARCHIVE.md).

## Q-12 — High-end modern iPhone playability

User-requested backlog addition; not a claim of current mobile support.
Start with a physical recent Pro-class iPhone and record model, iOS/Safari version,
viewport/orientation and graphics preset. Desktop device emulation is not acceptance.

- Audit WebGL2/shader support, memory/asset loading, WebAudio gesture unlock,
  save persistence, interrupted/backgrounded sessions and resume behavior in Safari.
- Design touch-only flight/camera/fire/throttle/crew controls without requiring
  keyboard, mouse or an attached controller; retain existing desktop controls.
- Make menus, briefing, HUD, options and debrief fit landscape safe areas and
  readable touch targets; explicitly handle rotation and browser chrome.
- Exercise Quick Mission and career from start through flight, debrief, save and
  reload on device. Include repeated sorties and app switching.
- Measure sustained frame-time distribution, stalls, memory and thermal behavior
  over a representative 15-minute flight before selecting the mobile preset.
  Provisional target: stable 30 FPS minimum, aim for 60 FPS on high-end hardware;
  establish the exact device/quality budget from the spike rather than promise
  desktop Ultra or infer performance from emulation.
- Dependencies: mobile interaction design and access to a physical target device.
  Lack of device access blocks on-device acceptance, not code/layout investigation.

## Q-13 — Xbox controller coverage and ergonomics

User-requested backlog addition: make a modern Xbox controller work as well as
possible for all common controls, not merely provide basic stick input.

- Audit existing standard Gamepad mappings before introducing another convention.
  Cover pitch/roll/yaw, throttle, guns/jam clearing, bombs, target selection/padlock,
  camera/free look, crew station changes and aiming, time compression, pause,
  map, common wingman orders, end flight and menu/briefing/debrief navigation.
- Design contextual mappings or a discoverable modifier/radial scheme where buttons
  are insufficient. Avoid accidental destructive actions and awkward simultaneous
  chords; preserve keyboard, mouse and touch operation.
- Show accurate Xbox button prompts and a controls reference. Evaluate remapping,
  deadzones, sensitivity/inversion and connected-controller selection using the
  existing settings model; do not add options without a demonstrated need.
- Release held actions on disconnect, focus loss and mode changes. Test reconnect,
  multiple controllers and transitions among pilot, gunner and menus.
- Verify mapping semantics with deterministic tests, then play end to end on a
  physical Xbox controller. Record model/transport/browser; browser stubs alone
  cannot establish ergonomics or physical-device compatibility.
- Coordinate with Q-12 at the input-command seam; serialize changes to shared
  input/session files rather than implementing two competing control systems.
