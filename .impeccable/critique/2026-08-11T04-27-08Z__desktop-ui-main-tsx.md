---
target: tray-app UI (desktop/ui/main.tsx)
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 4
timestamp: 2026-08-11T04-27-08Z
slug: desktop-ui-main-tsx
---
Method: dual-agent (A: design review, unanchored · B: detector + measured browser evidence, isolated)

Mode: **Operate**. All ten heuristics apply. Reviewed at `510cf9f` against the *built* popover (`desktop/dist/ui`) rendered in Chrome at its true 420×560 @2×, with the context bridge stubbed, across seven states: `happy`, `firstrun`, `rough`, `failed`, `starting`, `stopped`, `multi`.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | The window reports **RUNNING** in emerald over a live LAN URL while `0 songs loaded` renders in the same neutral grey as `4,167 songs loaded` (`main.tsx:214`). It reports process liveness and calls it system status. `songs.generatedAt` crosses the bridge (`ipc.ts:30`) documented as *"the staleness signal"* and is never rendered — so "you exported the list three weeks ago" is knowable and unsaid. |
| 2 | Match System / Real World | 3 | `HOSTS` (`main.tsx:257-260`) translating `0.0.0.0`/`127.0.0.1` into "Everything on the network" / "This machine only" is the best decision in the file. It sits one row above "Poll interval" in bare milliseconds and a chip reading "env override" — implementation vocabulary at identical rank. |
| 3 | User Control and Freedom | 1 | Zero `keydown` handlers anywhere in `desktop/` — no Escape, no close affordance; the only dismissal is `blur` (`popover.ts:69`), which silently discards unsaved edits. No revert once a path is overtyped. `quit` (`main.tsx:510` → `main.ts:215`) stops the server for a whole room, unconfirmed, from the highest-chroma element on screen. |
| 4 | Consistency and Standards | 2 | **Two commit models in one form**: the login checkbox writes on change (`main.tsx:478-488`); everything else waits for Save. Nothing distinguishes them. `index.css:4` claims "same authority as the web client" then re-forks every recipe — buttons `px-3 py-2 text-[11px]` vs the client's `h-[38px] px-[20px] text-[13px]`; fields a 1px 5px-radius rectangle vs the client's inset-stroke pill; cards `rounded-[10px]` vs `.yarg-card`'s 20px; `#FF7B84` typed as a literal (`main.tsx:69`). |
| 5 | Error Prevention | 1 | An env-overridden Port renders fully editable with Save enabled (`main.tsx:428-437`), while `types.ts:205-207` states such edits "have no effect… and are never written to the file." `min`/`max` on both number fields reach no `aria-valuemin/max` and have no validation path. Nothing guards Quit. |
| 6 | Recognition Rather Than Recall | 3 | `PathStatus`'s three-way split (`main.tsx:365-368`) is a real domain insight — found / missing / *"no currentSong.json yet — YARG writes it when it plays"* — and it is stated in words, not only colour. But the CSV instruction naming *Settings → Export Songs List* vanishes the moment a path exists (`main.tsx:398`), and "env override" explains itself only in a `title` tooltip. |
| 7 | Flexibility and Efficiency | 2 | No Ctrl+S, no Enter-to-save, no Escape. `save` is not in the tab order at all until a field is dirty. No route to the log the app writes (`%APPDATA%\yass\logs\server.log`), no "reveal in Explorer", no "open settings.json". Copy is the only accelerator and the tray menu already has it. |
| 8 | Aesthetic and Minimalist Design | 2 | In-page detector: `flat-type-hierarchy` — six sizes (10/11/12/13/16/18px) inside 8px of range, ratio 1.8:1. The wordmark header and four-button footer spend ~18% of a 560px window re-offering what the tray icon and its right-click menu already are. |
| 9 | Error Recovery | 1 | `failed.png` gives one red sentence and a `RESTART SERVER` button that reproduces the failure exactly. The diagnosis (port taken) and the cure (the Port field, 336px away) are on the same screen and nothing connects them. `run()` (`main.tsx:305-313`) is `try/finally` with **no `catch`**; neither has `pickDirectory().then()` (`main.tsx:383`). A rejected save, restart or picker fails in total silence. |
| 10 | Help and Documentation | 2 | The firewall sentence (`main.tsx:239-242`) pre-diagnoses the real #1 failure of a Windows LAN server in one line — and offers nothing to do about it. No route to a log, a firewall rule, or YARG's export docs. |
| **Total** | | **19/40** | **Poor** |

The band language ("core experience broken") overstates the happy path, which is genuinely fast: click, read, shout an address, four seconds. It does not overstate anything else. An Operate surface is judged on the moments it gets opened, and two of the three moments this window exists for are the broken ones.

For continuity: the guest client scored **25/40** last run. The popover is strictly worse on accessibility — the client has a live region, Escape-unwinds-one-layer, and a verified focus ring on all eleven interactive component types; this window has none of the three.

## Design Specificity Verdict

**LLM assessment: a generic settings dialog with an unusually good copywriter attached.**

Strip the strings and this is indistinguishable from any Electron utility's preferences pane: wordmark + version, a status card, six labelled fields at uniform `space-y-3` (`main.tsx:334`), a footer of four pills. All seven states share **identical structure**. `failed.png` (the server cannot bind; the party is not happening) and `stopped.png` (idle, nothing wrong) differ by one line of red text and are otherwise pixel-siblings. A surface whose job changes completely between "get me a URL to shout" and "fix this now" never changes shape.

Three concrete ways it fails to be *this* product's control surface:

**It knows about files and ports, not about the party.** Mid-party a host wants two facts: is anyone connected, and is the now-playing feed alive. Neither exists. The nearest thing is `currentSong.json found` — an `existsSync`, not a liveness signal. The window offers a button called `reload browsers` that implies connected browsers exist while refusing to say how many.

**`multi.png` is the tell.** Three LAN URLs at identical weight with three identical `COPY` buttons, no labels, no ranking, captioned "Hand one of these to a guest." One is Wi-Fi, one is VirtualBox, one is WSL. Two of them will not work and the host finds out across a loud room. `networkInterfaces()` supplies the adapter name and `server/src/core/net.ts:22` throws it away.

**The thing being transferred is a URL, into a phone, in a room — and there is no QR code.** That is the single most product-specific move available here and the window doesn't make it. A host currently reads `http://192.168.1.24:4321` aloud over music while six people type it wrong. `qrcode` renders SVG with no network access, which is the constraint this app already designed around.

**And it declines the design system it claims to speak.** `index.css:11-15` deliberately drops the Google Fonts imports so the window can't render differently offline. Measured consequence (rendered-width probe, not `document.fonts.check`, which returns `true` for `"ZzQqNoSuchFamily"`): `document.fonts.size === 0`; the declared display stack renders at **350.97px — byte-identical to `system-ui` and to `"Segoe UI"`**. The `YASS` wordmark, every uppercase field label, every button label and the status word ship in **Segoe UI, not Red Hat Display**. Numeric text lands in Inter *only because Inter happens to be installed on this machine*; on a clean Windows host `--font-data`'s tabular-figure intent vanishes with no signal. The reasoning behind the omission is right; the conclusion is not, when self-hosting two woff2 inside the asar was available.

**Deterministic scan: `detect.mjs --json desktop/ui/main.tsx desktop/ui/index.html` → `[]`, exit 0.** Re-run with `--no-config`: also clean.

**That clean result is an artifact, and the browser pass proves it.** `main.tsx` is Tailwind brackets plus custom properties; the static regex pass cannot resolve `text-[10px]`, `color-mix(in oklab, …)`, `var(--yarg-*)` or `@layer` order. The **same detector run inside the page** found **10** anti-patterns in `rough`, 9 in `multi`, 5 in `happy`. Read the CLI's 0 as *not measured*.

- `undersized-ui-text` ×3 — **real, all three.** `copy` is an interactive control at 10px in a 20px box; `env override` is a status badge carrying real meaning; `v0.1.0` is the least defensible only because it matters least. A fixed-size desktop window is not a space-constrained viewport.
- `tiny-text` ×5 — **partly real.** The three 11px warning rows in `rough` are the diagnostic content a host must read to fix a broken import. The 11px help paragraphs are defensible as secondary chrome.
- `flat-type-hierarchy` (1.8:1 over six sizes) — **real, and the one a 420px popover least gets a pass on**, since the whole window is a single glance.
- `ai-color-palette` "cyan neon on dark" — **false positive.** `#45D8FE` is `--yarg-vivid-sky-blue`, a vendored YARG token, deliberately marking the copyable URL, measured at 11.90:1. The rule is pattern-matching a house style it has no context for.

**Visual overlays: injection succeeded, no tab exists for you to look at.** Mutation was verified (`document.title` swap, `<script>` append-and-execute), the live server ran on port 8400, `detect.js` loaded and built 19 overlay nodes; the server was stopped and the headless context closed. There is **no `[Human]` tab with overlays** — the counts above are a console read. Worth noting the harness page carries no CSP; the real `desktop/ui/index.html` ships `script-src 'self'; connect-src 'none'`, which would have blocked the injection outright.

**A correction to my own evidence.** My screenshot harness passed `--hide-scrollbars=false`, which Chrome parses as truthy and *suppresses* scrollbars. Every PNG in the first round — and Assessment A's reading of them — was 15px optimistic, and A's "0px scrollbar, no affordance whatsoever" finding was an artifact of my flag, not a property of the window. Re-shot without it: a classic 15px Chromium scrollbar **does** render, and is visible. What survives is narrower and still real: the content overflows in four of seven states (`happy` 67px hidden, `multi` 119px, `rough` 238px), the scroll gutter makes the same form **15px narrower in `happy` than in `failed`**, and in `rough` the Song-list-export input is sliced mid-control at the footer edge.

## Overall Impression

The prose in this window is the best writing in the repo — "Everything on the network", "no currentSong.json yet — YARG writes it when it plays", "Hand one of these to a guest. If they can't reach it, the firewall prompt was probably dismissed", and a tray menu that names Quit for its effect on the party rather than on the process. Someone thought hard about the room.

Then that thinking stopped at the sentence and never reached the layout. Every state renders the same six fields in the same order at the same rank, so the window that knows the port is taken displays that fact as one red line and puts the fix 336px below it, unmarked. The single biggest opportunity is to make the status card **state-shaped rather than status-labelled** — let it become the remedy when something is broken, the address when things are fine, and push all six settings behind a disclosure the host opens twice a year.

## What's Working

1. **The copy is authored, not templated.** `HOSTS` gives the host the abstraction they're actually reasoning about — a room, not a socket. The firewall sentence pre-diagnoses the real top failure of a Windows LAN server before it happens. `tray.ts:55` renames Quit to *"Quit YASS (stops the server)"*. This layer is genuinely good and nothing below should be read as an argument to touch it.
2. **`PathStatus` ships three states where every other settings dialog ships two.** The third — configured correctly, just not played yet — is precisely the case that would otherwise show a red X and send a host hunting a non-problem. And it says so in words, so it survives being unable to see the dot; the 6×6px dot is correctly `aria-hidden`.
3. **The draft-merge protects typing from the poll.** `apply()` (`main.tsx:268-280`) keeps only fields whose draft diverges from the pushed value, so a background refresh can never overwrite a half-typed path; a cancelled picker leaves the field alone (`main.tsx:385`). Invisible when it works, and the difference between a form you can trust with a 200-character path and one that eats it.

Measured and worth stating: **every enabled text/background pair passes WCAG AA.** Worst is the bind error at 4.96:1; muted labels sit at 6.94–7.03, hints at 5.08–5.15, the accent pill's dark-on-light at 6.79. The documented `--color-border-strong` deviation is verified doing its job at **5.15:1** against the 3:1 it was chosen for. Contrast is not this window's problem.

## Priority Issues

**[P0] The status card labels a state instead of responding to it.**
- **What**: `firstrun.png` — **RUNNING** in emerald, a live LAN URL, a `COPY` button and "Hand one of these to a guest", above `0 songs loaded` set in the same neutral grey `4,167 songs loaded` uses (`main.tsx:214`). `failed.png` — "Port 4321 is already in use on 0.0.0.0" and a `RESTART SERVER` button that will fail identically, with the Port field 336px away and unmarked.
- **Why it matters**: These are two of the three moments the window exists for. In the first it actively encourages the host to shout a URL that leads to an empty app. In the second — music off, people waiting — it holds the diagnosis and the cure on one screen and refuses to connect them. Neither state offers any reassurance that settings and songs survived.
- **Fix**: On `failed`, the card body *becomes* the remedy: "Port 4321 is taken → **[Use 4322 instead]**", scroll-and-focus the Port field, mark it. On `count === 0`, suppress the guest URL and put the export instruction in the card with a `Choose the export…` button wired straight to the picker. Render `songs.generatedAt` as "exported 3 weeks ago" past a few days — it is already in the payload.
- **Suggested command**: `/impeccable harden`

**[P1] The address is the payload, and it is the smallest thing in the window.**
- **What**: the LAN URL renders at 12px (`main.tsx:150`) beneath an 18px wordmark you don't need — you just clicked the icon to get here. In `multi.png` three addresses render at equal weight with three identical `COPY` buttons and no adapter names, two of which are virtual and unreachable. No QR code anywhere.
- **Why it matters**: this string is read aloud across a loud room and typed into phone keyboards. It is the one output the whole app exists to produce.
- **Fix**: make it the largest thing on screen, in the numeric face, port visually separable. Label each interface ("Wi-Fi", "Ethernet", "VirtualBox Host-Only"), sort real adapters first, collapse the rest behind "2 other addresses", give each copy button an accessible name containing its address. Add an offline-generated QR.
- **Suggested command**: `/impeccable layout`

**[P1] The form promises changes it knows it cannot make.**
- **What**: three separate instances. An env-overridden Port is fully editable with Save enabled, against `types.ts:205-207`. `SaveResult.applied` — the flag that knows whether the running server took the change live — is computed in `config.ts:104/118/127` and **discarded** at `main.ts:150`, so "saved" reads identically whether it applied or only reached disk, in exactly the `liveApply === false` state where the difference is the entire point. And the restart banner says *"The bind address only takes effect…"* while firing whenever `draft.port` changed (`main.tsx:325` vs `:346`) — change only the port, get told about the bind address.
- **Why it matters**: a host changes a port mid-party, sees "saved", restarts, nothing moves. That is the failure that sends people back to hand-editing `settings.json` — the exact thing this window replaced.
- **Fix**: render env-overridden fields read-only with the variable name inline (`YASS_PORT=4321`) instead of a 10px tooltip-only chip. Return `applied` through IPC and let the footer say "saved — applied now" vs "saved — takes effect on restart", with the restart button right there. Make the banner name whichever field actually changed.
- **Suggested command**: `/impeccable clarify`

**[P1] The footer's loudest button ends the party, and its bulk pushes the first-run instruction under the fold.**
- **What**: `QUIT` in imperial red is the highest-chroma element in all seven frames, permanently enabled, 8px from `OPEN`, four letters, no confirmation (`main.ts:215`). The footer holds four unrelated verbs — commit, broadcast, navigate, destroy — at identical rank, four of six items duplicated from the tray menu (`tray.ts:45-56`), and the one action unique to this window (Save) shares their shape. Header + footer cost ~18% of 560px, and the bill is paid in overflow: `rough` hides 238px, `firstrun` cuts the "Reachable from" select mid-glyph.
- **Why it matters**: a host reaching for this window mid-party is stressed and moving fast, at 420px wide with an 8px gutter between a benign button and one that stops the music for everyone. Peak-end: the last thing on screen, always, is a threat.
- **Fix**: cut the footer to Save alone and drop the wordmark — that is ~90px, more than the happy-state overflow. Move Quit to the tray menu, which already names it honestly; if it stays, adopt that label and confirm while guests are connected.
- **Suggested command**: `/impeccable distill`

**[P1] The keyboard and screen-reader floor is below the rest of the product.**
- **What**, all measured: **zero** `aria-live` / `role="status"` / `role="alert"` / `<output>` in any state — status changes, the bind error, the song count, the warning list and `copied` all change silently. **The focus ring is cancelled on every field**: `.yarg-focusable:focus-visible` sits in `@layer components` and Tailwind's `.outline-none` (from `FIELD_CLASS`) sits in `@layer utilities`, which wins; both text inputs, both number inputs and the select measure `outline-style: none`, leaving a 1px border flip at **2.34:1** — under SC 2.4.11. Buttons and the checkbox are fine at 11.90–12.06:1. Every `Field` wraps input *and* sibling button in one `<label>`, so Chrome computes the textbox's name as `"YARG DATA FOLDER BROWSE currentSong.json found"`. No `main` landmark; the scroll region is in none. `copy` is **45×20px** (SC 2.5.8 wants 24 minimum) and appears three times in `multi`; the checkbox is 16×16 in a 371×22 label. No Escape.
- **Why it matters**: the client cleared exactly these bars last cycle. This window regressed them in a surface that is *only* status.
- **Fix**: one polite live region for status/count/errors and an assertive one for the bind failure; drop `outline-none` from `FIELD_CLASS` or move the ring into `@layer utilities`; split the `<label>` so it wraps only its control and attach hints via `aria-describedby`; grow `copy` to ≥24px and give it `aria-label`; wire Escape to `hidePopover`.
- **Suggested command**: `/impeccable audit`

## Persona Red Flags

**Jordan (first-timer)** — the primary persona; first run is literally moment one.
- `firstrun.png` tells them everything is fine: green **RUNNING**, a live URL, "Hand one of these to a guest" — while `0 songs loaded` sits in neutral grey. They copy it, shout it, and a guest gets an empty app.
- The instruction that fixes it is below the fold. The scrollbar is there, but nothing about the hard footer edge says the content continues past it.
- `Poll interval` in bare milliseconds carries the same label weight as `YARG data folder`. Jordan has no basis for deciding whether `1000` is right and no signal that it doesn't matter.
- Two commit models: they toggle "Start YASS when I sign in" (saves instantly), type a path, click away — the popover vanishes on blur and the path is gone, with no unsaved cue except a disabled button they cannot read (the disabled accent pill measures **1.93:1**; WCAG exempts disabled controls, so this is a design failure rather than a conformance one, and it is the primary action in its resting state).

**Riley (stress tester)** — owns the mid-party break.
- `failed.png`: one red sentence and a button that reproduces the failure. No suggested port, no free-port pick, no focus jump, no "your songs and settings are fine".
- `rough.png` stacks three CSV warnings, the restart banner and the live-apply note *above* every actionable control, pushing 238px of fields off-screen at the exact moment they're needed. The warning list is an unbounded `<ul>` (`main.tsx:221-228`) — forty bad rows push the entire form out of the window.
- Save, restart and picker rejections are unhandled. Under stress the window's response to a real failure is nothing at all.
- The restart banner names the bind address for a port-only change, so Riley stops trusting the messages.

**Sam (accessibility-dependent)**.
- Zero live regions in a window whose entire purpose is telling you what state the server is in.
- Five of the window's controls have no visible focus ring at all.
- `multi` puts three buttons named exactly `copy` in the tab order with their addresses in adjacent non-focusable `<code>` elements. Nothing associates them.
- Accessible names are all-caps in the AX tree (`"SAVE"`, `"RESTART SERVER"`) because `text-transform: uppercase` feeds the accname computation.
- No Escape, no Ctrl+S, no Enter-to-save; `save` isn't in the tab order until something is dirty.

## Minor Observations

- `.yarg-label`'s `line-height: 100%` clips the glyph box on every display run: `h1` `scrollHeight 21 > clientHeight 18`, status `15 > 13`, all six field labels `13 > 11`. Uppercase hides most of it, but the box is systematically 2–3px short of the type.
- Path inputs clip with no indicator and the **tail** is what identifies a folder: in `multi`, `scrollWidth 456 > clientWidth 288` — 37% hidden, cut mid-token at `…\PortableInstall\persist`. The LAN URL rows, by contrast, `truncate` correctly and never overflow.
- Radii are hardcoded literals (`rounded-[10px]`, `[5px]`, `[50px]`) rather than the `--radius-*` tokens the client aliases; every type size is a one-off bracket value, none from `typography.css`, whose small end stops at 12px.
- `main.ts:106` builds the tray tooltip from `localUrl` — `127.0.0.1`, the one address useless to a guest — while `shareableUrl()` sits five lines below at `:130`.
- `busy` only changes the restart button's label; the rest of the form stays fully interactive during a restart with no indication anything is happening. `Starting…` has no motion.
- `openAtLogin` reflects pushed state, not a local draft, so it doesn't move until the IPC round-trip returns — it reads as a dead control on a slow machine.
- `saved` never expires; it clears only on the next `edit()` (`main.tsx:302`), so the footer can still read "saved" ten minutes later for a save the host has forgotten making.
- The disabled `reload browsers` / `open` pills measure 1.10:1 fill and 1.70:1 ring against the page — they effectively vanish rather than read as disabled.
- `HelperBar` — described in the repo as *"the strongest identity cue in YARG's chrome"* — is the one component this window's bottom bar could have been, and it hand-rolls a `border-t` strip instead.

## Questions to Consider

1. The tray's right-click menu already does restart / reload / open / copy / quit. **What is this window for that a menu cannot be?** Answer that and the footer disappears, and the fold problem with it.
2. What if it rendered **one thing at a time** — the address when running, the fix when broken, the export instruction when empty — with all six settings behind a single disclosure?
3. The host never types a bind address; they answer a question about a room. **What if there were no fields at all on first open** — just "YASS is at 192.168.1.24:4321 with 4,167 songs" and a way in?
4. The window is 560px tall and the content wants 461–699px. **Why is the height a constant** (`popover.ts:15-16`)? A tray popover can size to its content.
5. `currentSong.json` is right there and the server already polls it. **What changes if this window shows what YARG is playing right now?** The host would know instantly whether the whole pipeline works, and it would stop being a settings dialog and start being a control surface.
6. If a party runs four hours and the host opens this window twice, **what should the second open look like** — and is it the same window as the first?
