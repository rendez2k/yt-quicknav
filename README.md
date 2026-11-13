# YouTube Quick Nav + Cinema

## Long-video Highlight Reel scaling (`Skim / Balanced / Deep`) & GitHub Releases auto-update workflow — 1.44.0 (13 November 2026)

- **Duration-Scaled Highlight Reel (`tldrReelBudget` + `Skim / Balanced / Deep`):** Eliminates fixed 5-clip / 28-second short-video caps on long talks, podcasts, and reviews — scaling clip budgets (`5` up to `26` clips, `25s–90s` per clip), adapting to wide YouTube heatmap buckets (`36s–72s` on 1–2 hour videos), guaranteeing major chapter/timeline-zone coverage on videos `>= 12 min`, pulling in 1–2 preceding setup sentences so punchlines never start mid-thought, coalescing nearby clips seamlessly, and adding an instant **`Skim · Balanced · Deep`** selector right inside the `⚡ TL;DR` card.
- **GitHub Releases Update Notifier + 1-Click Local Updaters (`rendez2k/yt-quicknav`):** Periodic 12-hour background & popup checks against GitHub Releases via standard CORS (zero new Chrome permissions), displaying an **`⬆ Update available`** banner + toolbar `↑` badge when a new release ships, paired with `.github/workflows/release.yml` automated release publishing and bundled `Update-Windows.cmd` / `Update-Mac-Linux.command` 1-click updaters inside the friend `.zip`.

## Real-time remaining clock, live-synced transcript, clean end-screens, frame capture, A–B loop & Shorts player — 1.43.0 (11 November 2026)

- **Live "Real Time Left" + Finish-At Clock (`#yqn-time-left`):** Displays true wall-clock time remaining right beside YouTube's player timer (`· 7:42 left`), accounting for your base playback speed plus every upcoming `skip` and `speed` segment ahead of the playhead (or remaining TL;DR highlight reel clips), with a hover tooltip showing estimated finish time (`finishes ~17:04 · 2:18 of cuts ahead`).
- **Interactive Live-Synced Transcript + Quote Copy (`Shift+F`):** When the `Search` box in **Video tools** is empty, displays a live transcript that highlights and gently auto-scrolls the currently spoken line in real time (with a `Follow playback` toggle and a one-click `📋` button on every line to copy `"quote" (m:ss — link)`).
- **Clean End-Screen Declutter (`cleanEndscreen`):** Hides blocking `.ytp-ce-element` recommendation overlays and corner watermarks during the final seconds of playback so slides, charts, and code remain readable (hold `Alt` anytime to peek at end-cards).
- **Full-Resolution Clean Frame Capture (`📸 Frame` / `Shift+S`):** Captures the exact `<video>` frame at full native stream resolution (`1080p`/`4K`) with zero player HUD, gradients, or captions — copying the PNG straight to your clipboard (`Shift+click` downloads `Video Title - 04m12s.png`).
- **A–B Section Loop (`🔁 Loop` / `Shift+L`):** Press once to mark **A**, press again to mark **B** (drawn as a blue bracket on the timeline that automatically suppresses Auto-Cut skips inside your loop with sub-20ms wrap-around), and press once more to clear.
- **Shorts → Normal Watch Player (`↗ Full player` + `redirectShorts`):** Adds a floating `↗ Full player` pill (and `Shift+W` shortcut) on `/shorts/` pages, plus an optional popup setting (`Open Shorts in normal player`) that replaces `/shorts/<id>` with `/watch?v=<id>` via `location.replace` without breaking browser Back navigation.

## Transcript search, SponsorBlock highlights, thumbnail badges, speed pill, playlist advance & time-saved dashboard — 1.42.0 (11 November 2026)

- **Instant Free Transcript Search (`Shift+F` + `Video tools → Search`):** Sub-10ms client-side keyword and phrase search across video captions (including multi-word queries that span YouTube's 3-second auto-caption fragments), with highlighted matches and one-click/Enter timestamp jumps that temporarily bypass active cuts — zero API keys required.
- **SponsorBlock "Point of Interest" (`poi_highlight`) Support:** Piggybacks `poi_highlight` onto existing SponsorBlock hash-prefix lookups, painting gold highlight ticks on the timeline, prioritizing community highlights in `🔥 Peak` (`Shift+H`) and `⚡ TL;DR` digest scoring/reels, and supporting one-click `Highlight (point of interest)` community submissions in **Video tools → Mark sponsor**.
- **Feed Thumbnail "Effective Runtime" Badges:** Hovering YouTube feed, search, sidebar, or playlist video cards previews the post-cut runtime (`→ 14:10`), saved time (`−0:45`), prepared status (`⚡ Ready`), or community highlight (`★ 1:20`) in the bottom-left of the thumbnail.
- **Cumulative Time-Saved Dashboard (Today / 7 days / All-time):** Tracks aggregate time saved across skips, speed-ups, live dead-air trims, and TL;DR highlight reels in the extension popup (with one-click reset and JSON backup/restore support).
- **Inline `⏩` Speed Pill with Scroll-Wheel Fine Control:** Click `#yqn-speed-btn` to cycle `1× → 1.25× → 1.5× → 1.75× → 2×`, scroll the mouse wheel over the pill for `±0.1×` adjustments (`0.5×`–`3.0×`), or `Shift+click` to pin/unpin the speed for the current channel.
- **Instant Playlist / Watch Later Outro Advance:** When watching inside a playlist (`&list=...`) and Auto-Cut skips an outro/credits segment reaching the end of the video (`end >= duration - 3s`), automatically clicks YouTube's Next button to advance immediately without waiting on end-screen countdowns.

## TL;DR Mode: Instant Summary Card + Playable Highlight Reel — 1.41.1 (11 November 2026)

- **Floating `⚡ TL;DR` Summary Card (`#yqn-tldr-btn` + `Shift+T`):** One click or `Shift+T` opens a digest card showing runtime compression (`10:00 → 1:24 (−86%)`), a bottom-line summary, timestamped key takeaways you can click to jump directly to, and curated highlight clips with spoken quote previews.
- **Playable Highlight Reel (`▶ Play Highlight Reel`):** Plays only the video's highest-signal clips back-to-back with sub-20ms boundary scheduling, updating live status (`TL;DR reel 1/4 · ...`), crediting saved time, and pausing cleanly when the final highlight finishes — works even when Auto-Cut is turned off.
- **Hybrid AI + zero-key free fallback:** Uses verified Claude/Thorough summaries, takeaways, and selective keep windows when AI is enabled, and automatically falls back to YouTube Most-Replayed local peaks, native chapters, and high-signal caption extraction (verdict/conclusion cues, numbers/comparisons, final-third synthesis, with sponsor/promo lines excluded) when AI is off.
- **`TL;DR (highlights only)` Viewing Preset (`cutPreset: 'tldr'`):** Upgrades all `speed` segments (filler, low-replay dips, routine detail, non-highlights) to outright `skip` while leaving paid provider toggles and API keys untouched, plus one-click Markdown export (`📋 Copy`).

## Smarter cutting & fast-forwarding mechanics — 1.40.0 (11 November 2026)

- **Exact boundary lookahead + pre-speech soft landings:** Schedules exact wall-clock boundary timers (`(boundary - currentTime) / playbackRate`) instead of relying solely on `250ms` polling, and decelerates `220ms` early before returning to normal speech so the first syllable of a highlight is never clipped at `3×`.
- **Speech-density (WPM) & B-roll adaptive speeds:** Annotates `speed` segments with spoken words-per-minute when captions are available — automatically tempering rapid talkers to an intelligible `~420 WPM` ceiling while boosting silent/sparse B-roll by `+0.5×`.
- **Anti-whipsaw micro-gap coalescing:** Bridges tiny unverified gaps (`<= 2.0s` between `speed` blocks, `<= 1.0s` between `skip` blocks) without touching verified AI highlights or user overrides, eliminating `3× → 1× → 3×` rate flutter.
- **Adaptive noise-floor silence cutting:** Calibrates `SilenceDetector` against rolling speech peaks vs. ambient room tone / quiet background music (`320ms` pause pickup, `50ms` audio cadence, `0ms` speech-onset recovery).
- **Buffer-aware short skips:** Checks HTML5 `TimeRanges` (`v.buffered`) before short non-sponsor skips (`<= 3.5s`), bursting smoothly at `4×` when the target isn't buffered yet to avoid MSE keyframe seek stalls.
- **Context-rich skip toasts + YouTube `Hold-to-2×` protection:** Displays skipped duration, landed topic, and `Shift+Z undo` on skips, and guards your base playback speed when using YouTube's hold-`Space` / hold-player `2×` gesture.

## Faster first-load scanning & progressive cuts — 1.39.1 (11 November 2026)

- **Early `document_end` startup:** Content scripts now start scanning at `DOMContentLoaded` (`document_end`) instead of waiting for YouTube's full `window.load` (`document_idle` subresources/ads/thumbnails).
- **Parallel SponsorBlock + YouTube page data:** SponsorBlock lookup and YouTube caption/heatmap extraction now launch simultaneously rather than waiting for SponsorBlock to return before requesting captions.
- **On-click (`pointerdown`) SponsorBlock prefetch:** Clicking any YouTube `/watch?v=...` link starts the privacy-preserving SponsorBlock hash-prefix lookup immediately during navigation.
- **Zero-network SPA data reuse:** Reads live `ytd-watch-flexy` watch-next and player data on in-app YouTube navigations (eliminating redundant `/youtubei/v1/next` round-trips), runs heatmap + transcript extraction concurrently, and checks targeted subtrees (`frameworkUpdates`, `playerOverlays`, `engagementPanels`) before full tree walks.
- **Eliminated duplicate startup checks:** Batches startup storage/foreground checks in `Promise.all` and reuses verified video metadata across preference loading and Auto-Cut startup without a second bridge round-trip.
- **Multi-stage progressive publishing & playhead-first Thorough scanning:** Publishes SponsorBlock, Most-Replayed heatmap cuts, and fast Jev cuts to the timeline the moment each source finishes (rather than waiting for slower Claude passes), and prioritizes Thorough sections at or ahead of the current playhead when starting or seeking mid-video.

## Live audio silence speedup, per-channel speeds, SponsorBlock submit, hotkeys, global notes & backups — 1.39.0 (11 November 2026)

- **Real-time Web Audio dead-air speedup (`Speed up dead air`):** Taps a pre-compressor `AnalyserNode` to speed through sustained speaker pauses (`< -42 dBFS` for `>= 550 ms`) and drop back to normal speed the moment speech resumes — works on uncaptioned lectures and tutorials with zero API calls.
- **Per-channel normal playback speed:** Choose a preferred base speed (`0.75×`–`2×`) per channel in the Auto-Cut panel; Auto-Cut still accelerates `speed` segments and restores back to that channel's base speed afterwards.
- **One-click SponsorBlock community submission:** Select a SponsorBlock category in **Video tools → Mark sponsor** and submit directly to `sponsor.ajay.app` while also saving the override locally.
- **Watch-page & Chrome keyboard shortcuts:** Built-in watch-page hotkeys (`Shift+C` Auto-Cut, `Shift+Z` Watch last skip, `Shift+[` / `Shift+]` Prev/Next topic, `Shift+H` Peak, `Shift+B` Quick bookmark) plus configurable `chrome://extensions/shortcuts` commands.
- **Cross-video `All notes` search:** Search and jump across every saved bookmark and note by note text, video title, channel or video ID, and export matching notes to Markdown.
- **Settings, channel rules & notes JSON backup/restore:** Export and import settings, channel rules/speeds, learned corrections, per-video edits and notes from the popup — API keys are strictly excluded on both export and import.
- **Core hardening:** Ad-playback protection (`ad-showing`), multi-account YouTube InnerTube header forwarding, Web Audio peak brickwall limiter on 200–300% boost, CJK & technical-token Q&A retrieval, `claude-sonnet-5-5` pricing, unbilled HTTP error budget release, bounded storage eviction, and clean `npm run pack` staging into `dist/unpacked/`.

## Quiet Watch Later preparation — 1.38.11 (3 November 2026)

Preparation now reuses **one muted, paused tab in a separate minimised window**
for the Watch Later page and the batch's videos. It leaves your normal browsing
tabs alone and closes its window when the batch finishes or you stop it. You
may see the minimised Chrome window on your taskbar while it works.

Restoring the window lets you inspect or watch the current video. That page then
stays open for you; remaining videos use a new minimised window. Moving the tab
or adding another tab also prevents it from being reused or closed automatically.
Selecting the only tab inside a minimised window no longer counts as opening it.

Your existing schedule of up to five videos every 30 minutes, saved analysis,
section edits, provider settings and spending limits are preserved. No additional
permissions are required. Reload the extension and refresh open YouTube pages
to load the update. Preparation already in progress finishes in its current tab;
subsequent videos use the separate window.

## Playlist activation no longer cancels preparation — 1.38.10 (3 November 2026)

The temporary Watch Later page can become active even when you did not select
it. This now keeps the batch running, just like opening a preparation video.
An active playlist waits for its entries to appear, reads the entries already
loaded, and stops automatic scrolling. The page stays open for you while video
preparation continues. The five-video limit, 30-minute schedule and AI spending
limits are unchanged.

Live verification completed the first queued video (545/545 caption lines),
advanced automatically to the second, and reopened the first from its saved
plan: 3 skip sections and 26 speed sections. Sponsor skipping, speed changes and
return to normal playback were checked in Chrome. Thorough preparation took
about seven minutes for that 19-minute video; reopening its saved plan was
immediate. This is one observed run, not a guaranteed processing time.

## Open a preparation video without stopping the queue — 1.38.9 (3 November 2026)

Opening a video that is being prepared now lets you watch it while analysis
continues. The extension keeps that tab open and moves on to the next queued
video when its plan is saved. It does not start a second analysis for the tab.
The queue status also shows the current title and caption lines checked during
Thorough analysis. The playlist activation behaviour was subsequently updated
in 1.38.10 to keep preparation running without scrolling an active playlist.

Your five-videos-every-30-minutes schedule, spending limits, saved plans and
section edits are unchanged. Reload the extension and refresh YouTube to load
this update.

## Queue recovery and promotion checks — 1.38.8 (3 November 2026)

Watch Later preparation now survives YouTube removing tracking parameters from
its URLs. The extension still verifies that it owns the tab and that the tab is
on the expected video or Watch Later page. It stops if you navigate its tab
elsewhere. The next scheduled batch is 30 minutes after enabling,
so it cannot accidentally follow an initial quick batch a few seconds later.

Promotion instructions explicitly cover Super Thanks, donations and private
community pitches, including the explanation of their benefits. Introducing a
creator's own store and what it sells is distinguished from a bare conflict-of-
interest disclosure. These refinements apply to new analysis and Re-analyse;
complete prepared plans are retained to avoid making you wait through them again.
Your saved corrections still take precedence over model decisions.

The reported donation/Discord appeal was verified live as a skip at **8:05–8:26**.
Cached playback jumped from inside that appeal to the review after it. The
reported opening VIVO store mention was saved as a local skip at **1:19–1:27**.

## Watch Later preparation and faster checking — 1.38.7 (3 November 2026)

**Auto-Cut → Prepare Watch Later automatically** prepares up to **five videos
every 30 minutes** while Chrome is open and YouTube is signed in. The same switch
is in the extension popup. **Prepare Watch Later now** starts a batch immediately;
**Stop preparation** stops that batch. Turn the switch off to stop future batches.

Preparation reuses one muted, paused YouTube tab in a separate minimised window,
your enabled analysis sources and the existing AI spending limits. It reads up to 500 loaded
Watch Later entries, skips open/prepared videos, honours ignore and channel
preferences, and saves complete results for normal playback. Opening YouTube
pages may affect browsing/watch history; the extension does not edit the playlist.
The playlist and queue stay local. Only the normal video analysis inputs go to
your enabled providers. This feature is off until enabled.

The queue shows progress and incomplete results. Failed or interrupted videos
wait at least a day before another automatic attempt with the same settings;
spending-limit failures stop the current batch. A restart does not replay a lost
paid request. Opening a preparation video lets you watch it while the queue
continues; opening the temporary playlist tab uses its loaded entries without
further scrolling.
Chrome may delay scheduled checks when the computer sleeps or the browser closes.

Thorough analysis now works on **two sections at once** for the video you open;
each section still gets its own draft and review. Background preparation uses
one section at a time. Concurrency does not add provider calls. The smaller
request batches and truncation recovery from 1.38.5 remain in place.

Commercial self-promotion now explicitly includes a creator introducing their
own shop and describing what it sells, even without external sponsorship or a
discount code. Ordinary review facts and neutral ownership disclosures remain
protected. Cache V15 rechecks old plans against this policy; your API keys,
settings and saved section edits are retained. Scheduling adds only the `alarms`
permission; no new website access is requested.

## Incomplete review recovery — 1.38.5 (3 November 2026)

The supplied VIVO review exposed why speed-ups appeared only near the end:
the first two Claude responses hit their output limit, leaving only **63 of
288 caption lines checked**. Waiting longer had not produced a complete review.

Thorough mode now sends at most 40 core caption lines per section, with bounded
neighbouring context, and asks for compact, grouped decisions. An explicitly
truncated response can be retried as smaller sections, each checked twice.
Recovery is limited to three splits, two levels deep, within the existing
per-video request and spending limits. Network failures are not replayed.

Verified sections still become active progressively. The panel says how many
caption lines were checked and sections processed; Diagnostics includes coverage
and failed time ranges without captions or credentials. An incomplete result
remains labelled incomplete and is not cached as a finished review.

Thorough mode still takes longer than the standard analysis because every
section receives two passes. Smaller sections can increase request count and
cost, while compact replies reduce output work and avoid the confirmed oversized
responses. The live VIVO re-run verified all 288 caption lines and produced
25 speed sections, including early passages; no precise timing comparison was
recorded. The later 1.38.7 release also checks sections concurrently.

Reload the extension and refresh YouTube to use this update. Existing successful
caches, keys, settings, saved edits and channel preferences are preserved.

## Speed-through recovery — 1.38.4 (3 November 2026)

Thorough analysis now reviews pacing as well as sponsor reads. Balanced pacing
looks for recaps, repeated examples, conversational padding, wordy transitions
and low-information asides. **Quick watch** / **Plus** also considers narrated
routine setup and extended detail after the main explanation. Key facts, first
demonstrations, critical instructions and results stay at normal speed.

Previously, Thorough mode ignored Plus when constructing its prompts and only
asked for speed on clear repetition. Even two agreed speed decisions were
discarded if their category labels differed. Speed now requires matching actions
and genuine caption evidence from both passes, each at medium or high certainty;
category wording can differ. Skips keep their existing high-certainty checks.
Low-confidence, ungrounded, conflicting and unreviewed passages remain unchanged.

Select **Auto-Cut → Viewing preset → Quick watch** for broader speed-throughs
at 3×, or **Gentle trim** for 2×. Sponsors only deliberately disables other cuts.
Diagnostics separately count proposed and accepted speed/skip caption decisions.
No fixed share of a video must be sped up, and model choices can still vary.

Reload the extension and refresh YouTube. Old analysis caches are invalidated
so the revised policy runs; your keys, settings, channel rules and saved section
edits are retained. The two-pass request count is unchanged. Automated tests use
simulated provider responses and do not measure live model accuracy.

## Topics and reliable captions — 1.38.3 (2 November 2026)

**Topics** beside the ⏮ / ⏭ buttons opens a named list of apps or subjects.
The arrows use YouTube's chapters immediately, including timestamp lists in the
description, and work with Auto-Cut and AI off. ⏭ moves to the next topic;
⏮ returns to the current topic's start, then the previous topic on a second press.
Click any topic to jump directly. The current topic is highlighted.

When there are no YouTube chapters, AI topics appear progressively during
Thorough analysis. The prompts explicitly request a topic for every app or item.
Topic navigation does not require a skip or speed-up decision for that section.
With no topics available, the arrows retain their one-minute fallback.

The Topics drawer distinguishes **skip** and **speed** counts and says when
analysis is still running or incomplete. Red timeline sections skip; amber
sections play faster; blue ticks mark topics. Thorough mode only speeds up
verified repetitive content: useful app demonstrations may all stay at normal
speed. No speed sections is a valid outcome, not a target to fill.

The caption fallback now recognises YouTube's modern transcript rows. It no
longer mistakes chapter titles for speech or includes screen-reader time labels
in the transcript. Old analysis caches are invalidated; saved keys, preferences,
channel rules and manual cuts are retained. Verification accepts equivalent
typographic punctuation while still rejecting altered wording. Auto-Cut and
Diagnostics now show why proposed caption decisions were rejected.

Reload the extension in `chrome://extensions`, then refresh the YouTube tab.
The supplied Android-apps video now exposes all **16 topics**, including the
sponsor section. The live check verified **1:47 → 1:53 (Scroll Light)**. Paid AI
responses were simulated during testing; this is workflow verification, not a
measurement of model accuracy. No permissions or paid calls were added for topics.

## Timeline and analysis status fixes — 1.38.1 (31 October 2026)

Cut markers now follow the visible timeline from a separate layer in the player.
They recover when YouTube replaces or hides a slider, resize with the timeline,
and avoid clipping inside YouTube's progress-bar elements. Red marks skips;
amber marks faster playback. Markers hide and return with the player controls.

While sources are still running, Auto-Cut says **checking…** and shows the
analysis stage. It no longer announces “nothing to cut” during an unfinished
review. Failures and partial results say **incomplete**; cuts kept by your edits
or preset are distinguished from an analysis finding no cuts. Empty/malformed
AI classifications are treated as incomplete results.

Reload the extension in `chrome://extensions` and refresh the YouTube tab.
Existing keys, preferences and saved cuts are preserved.

## Video tools — 1.38.0 (30 October 2026)

Open **Video tools** below a YouTube video:

- **Mark sponsor:** capture the current start/end or type seconds / `mm:ss`,
  preview at your normal speed, then save a local sponsor skip. A preview pauses
  at its end, even inside an existing cut. **Remove saved override** restores
  the analysis decision for that range. Saved cuts need Auto-Cut enabled and
  respect Ignore and review approval. Nothing is submitted to SponsorBlock.
- **Ask video:** ask a question using your configured Anthropic key/model.
  Answers cite exact caption quotes with clickable timestamps. A citation plays
  its passage once without immediately skipping it. Invalid quotes/IDs are
  rejected; missing evidence produces a “not covered” response. Long transcripts
  use relevant excerpts, explicitly labelled as partial. Captions cannot establish
  visual-only facts. Questions are sent only when you press **Ask this video**;
  navigation and closing the drawer cancel the outstanding request.
- **Notes:** bookmark the current time, add/edit/delete a note and export Markdown
  with timestamp links. Notes stay on this device, survive reload and are never
  sent to a model. Up to 500 bookmarks per video; the limit never silently deletes
  older bookmarks. The drawer retains drafts while analysis updates the cut list.
- **Diagnostics:** explain why the current timestamp was kept, including review
  approval, Ignore, Keep overrides, source failures and budget stops. Copy a report
  containing the video ID and playback state, without credentials, transcript text
  or raw provider responses.
- **AI usage:** see daily and per-video estimated USD, calls, reported tokens and
  pending/uncertain calls. The popup contains **AI usage and budgets** settings.

**Review cuts before applying** is available in the popup and Auto-Cut panel,
including channel preferences. Proposed cuts appear as striped timeline markers.
Playback stays unchanged until analysis finishes and you press **Approve these
cuts**. You can edit sections first. Approval is for this viewing; reload,
re-analysis or changed cut actions/boundaries require fresh approval. Partial
results remain visibly incomplete and can be explicitly approved.

Budgets are optional and default to unlimited (`0`). Every paid request reserves
a conservative estimate before dispatch, including Thorough passes, Jev batches,
questions and key tests. Reservations are serialised across tabs and stored before
the request; a worker restart, lost response or cancellation after dispatch does
not erase that estimate. Reported token usage replaces it when available. A limit
stops new requests; it does not cancel ones already in flight. Public API prices
are estimates, not a provider invoice cap, and exclude usage outside this extension.
Daily accounting uses the computer's local date; per-video accounting retains
90 days. The provider response is never replayed automatically after a network loss.

Claude prices were checked against the [official pricing table](https://platform.claude.com/docs/en/about-claude/pricing)
on 30 October 2026, including prompt-cache and Haiku long-context rates. Jev pricing
is user-configured in USD per million input tokens, assuming free output. Its
default `0` means unknown: calls are labelled unpriced and Jev is blocked while a
budget is enabled. Setting a Jev rate also estimates earlier unpriced calls.

Existing settings, keys, edits and channel rules are retained. No extension
permissions were added. **Reload the extension in `chrome://extensions`, then
refresh your YouTube tabs** to load the new scripts.

## Thorough analysis — 1.37.0 (30 October 2026)

Enable **Thorough analysis** in the toolbar popup or the in-video Auto-Cut panel.
It uses **AI highlights (Claude)** and your existing Anthropic key; selecting the
mode never enables a provider or replaces a key. The popup sets the default;
remembered channel settings can override it. Thorough mode replaces Jev's quick
verdicts with a dedicated two-pass Claude review.

Each section gets a content pass followed by an independent sponsor/boundary
check. Sections contain up to about five minutes or 18,000 characters, with
overlapping context. The whole available transcript is processed, rather than
only its opening portion. Every caption is tracked as checked or unchecked.

- Promotions require supporting transcript text. The reviewer also searches for
  sponsors missed by the first pass and distinguishes a pitch from a product
  review. Boundaries use caption IDs and available caption end times, rather
  than invented timestamps. Mixed captions containing useful content stay kept.
- Conflicting non-sponsor decisions, weak evidence, failed sections and visual
  gaps stay at normal speed. Verified useful content overrides weaker heatmap
  and generic cut suggestions. Community sponsor submissions stay active; you
  can override them using the section's **Keep** option.
- Dense tutorials have no target percentage to remove. Caption gaps alone no
  longer produce automatic "no talking" cuts in either mode.
- Community sponsors start immediately. Verified sections appear progressively;
  the panel shows the current step and caption coverage. **Show kept sections**
  reveals retained content. Hover over a reason to see its supporting quote.
  Chapter markers, section notes, takeaways and mentioned resources remain
  available. Notes and takeaways are from successfully reviewed sections.
- Complete plans are cached. **Re-analyse** invalidates the previous cached plan;
  incomplete results are not cached as complete. Navigation, Ignore, mode changes
  and the master off switch cancel pending Claude requests and subsequent passes.

Thorough mode makes two Claude requests per section and therefore uses more time
and API credit. Requests have a 90-second deadline. A run is bounded to 60 sections
(at most 120 requests); any remainder is explicitly reported as unchecked and
kept. No transcript or AI method can establish what happens in a visual-only gap.
The current checks validate the workflow, not a measured real-world detection rate.

**Learn from my cut corrections** stores category/action examples locally per
channel. Consistent choices on at least three distinct videos produce a suggested
rule, such as **Apply keep for demonstration (3 videos)**. Repeated edits to one
video do not count as separate examples. A suggestion only takes effect when
you apply it. The panel explains applied rules; per-video edits override them.
Disable learning to pause both collection and application, or use **Reset learning
for this channel** to remove its history and applied rules. Learning records are
never sent to AI providers.

After updating, **reload the extension at `chrome://extensions` and refresh your
YouTube tabs**. Existing settings, keys, channel rules and cut edits are retained.

## Playback controls — 1.36.0 (12 October 2026)

Open **Auto-Cut** below a video to use the new controls:

- **Watch last skip** appears in the status strip after a skip. It returns to
  that section at your normal speed and lets it play once before Auto-Cut
  resumes. It preserves pause/play state and refunds that skip's saved time.
- **Channel preferences:** choose a preset, then **Remember for this channel**.
  Future videos from that channel use those playback settings. **Off for this
  channel** disables cuts there; **Use defaults** removes the saved rule. Rules
  use YouTube channel IDs, so channels with identical names stay separate.
- **Editable sections:** each detected section has **Auto**, **Keep**, **Speed**
  and **Skip** choices. Changes update playback, the cut count and timeline
  immediately and are remembered for that video. **Auto** restores the source
  decision under the current preset; **Reset my cut changes** resets the video.
  Kept sections remain in the list, and personal choices override presets.
- **Live status:** see the current action, upcoming section and time saved
  during this viewing. Savings count real sped-up playback and skips made while
  playing, relative to your normal playback rate. Paused seeks earn nothing.
  The counter resets on reload/navigation; the panel's whole-plan potential
  saving is a separate estimate relative to 1× playback.
- **Presets:** **Sponsors only** skips detected promotions and keeps other
  sections; **Gentle trim** skips promotions and speeds other cuts to 2×;
  **Quick watch** enables aggressive trimming with 3× speed-through. **Custom**
  uses individual settings. Presets never enable an AI provider or change keys.

The toolbar popup sets global defaults. A saved channel rule overrides its
playback options, while the popup's **Enable Auto-Cut** switch remains the master
off switch. When a channel rule exists, changing its in-video preset updates that
rule. Otherwise it updates the global default. Analysis-affecting changes can
call providers you have already enabled; editing a section does not reanalyse.

Channel rules and per-video edits stay in this browser's local extension storage,
separate from the three-day analysis cache. Channel records contain playback
preferences only; provider switches and keys remain global. Uninstalling the
extension or clearing its local storage removes these records.

Reload the extension at `chrome://extensions`, then refresh your YouTube tabs
to load the current version. Existing settings and keys are retained.

## Reliability update — 1.35.1 (12 October 2026)

Fixed fresh plans failing to display their cut list/timeline markers, sponsor
boundaries being lost when merged with intros, stale analysis after navigation,
and playback control stopping when YouTube replaces the video element. Sponsor
cuts now apply while slower sources are still analysing. Fast sections restore
your previous playback speed. Changing speed settings applies immediately
without another analysis.

The panel distinguishes service failures from videos with no submitted cuts,
offers **Re-analyse** for complete and partial results, and stays inside the
window. Re-analyse bypasses the local cache and can call any enabled AI provider.

After updating this unpacked folder, click **Reload** for the extension at
`chrome://extensions`, then **refresh your open YouTube tabs**. Both page scripts
need to load the new version together. Your saved settings and keys are retained.

See [REVIEW.md](REVIEW.md) for findings, test coverage and live-test limitations.

A Chrome (Manifest V3) extension that:

- Adds a row of quick-access pill buttons under the video title on YouTube watch pages:
  **History · Watch Later · Subscriptions · Liked · Library · Like · Watch Later: toggle · Copy Link · Peak · ✂️ Auto-Cut · ⏮⏭ Chapter jumps · 🔊 Volume**
- Auto-opens videos in **cinema (theater) mode**.

The **Copy Link** button copies a shareable URL to the current video **at the
current playback time** (`…/watch?v=…&t=123s`) to your clipboard in one click.

The **🔥 Peak** button jumps to the **most-replayed moment** using YouTube's own
"most replayed" graph — press it again to hop to the next hot spot (top 5).
There's nothing to jump to on videos without "most replayed" data yet.

The **Like** and **Watch Later: toggle** action buttons colour themselves
**green when active** (liked / in Watch Later) and **red when not**.

## Volume

Click the **🔊 Volume** button and the volume controls expand **inline, inside
the bar itself** — no floating popup, so they can never drift away from the bar
when the page scrolls or YouTube reflows the layout:

- **Volume boost slider** — amplifies the player's audio beyond 100% (up to
  300%), for videos that stay too quiet even at full volume. Applies live as
  you drag.
- **Even** — the even-out-loudness compressor (VLC-style) that squashes loud
  peaks so quiet dialogue and loud action sit at a similar level. A pill
  toggle: green = on, red = off.

Click 🔊 again to collapse the controls. The button colours itself green and
summarises the state while anything is on (e.g. "Volume · 150%"), and the
settings stay in sync with the toolbar popup.

## Auto-Cut

The **✂️ Auto-Cut** button trims a video "more or less live": it analyses the
video once, then during playback **skips** the junk and **speeds through** the
dull parts. Sources (each toggleable in the popup):

- **Skip messaging** — SponsorBlock community data: auto-skips sponsor reads,
  subscribe/like reminders, intros, outros, self-promo (and speeds through
  tangents/filler). Only a privacy-preserving hash of the video ID is sent to
  `sponsor.ajay.app`.
- **Trim dull parts** — uses YouTube's own "most replayed" graph to speed
  through low-engagement stretches. Dullness is judged against the local
  neighbourhood (a rolling median), not the video's single hottest spike — so
  one viral moment doesn't get the rest of the video cut, flat videos are left
  alone, and only genuine dips are trimmed. No third-party service.
- **🐇 Speed only (sponsors still cut)** — a mode for the cautious: segments
  that would be skipped play at your speed-through rate instead, so intros and
  tangents flash past but you never miss a frame. The exception is promotions
  and direct audience asks — sponsor reads, self-promo, subscribe/like/bell
  reminders, merch, newsletter, membership and course pitches (matched across
  every source's wording) — which have no value at any speed and stay cut
  outright. Toggling it re-applies the current plan instantly (no
  re-analysis).
- **⚡ Plus (trim aggressively)** — an intensifier for every source: on the
  "most replayed" graph only the hottest stretches keep normal speed (shorter
  runs qualify too). AI editing remains content-led and preserves uncertain
  material, with no forced runtime quota. Speeds up at your chosen
  speed-through rate. Works even if "Trim dull parts" is off.
- **⚡ Jev fast cuts** — TypeSafe's Jev model ("System One") makes the
  keep/cut decision itself, fast: the transcript is split into ~45-second
  sections and Jev returns a typed verdict for each — **keep**, **speed
  through**, **skip as junk** or **skip as sponsor** — in a single parallel
  call, with probabilities instead of generated text. Only confident verdicts
  (≥ 60%) are applied, so murky sections stay on keep, and every cut shows its
  confidence in the cut list ("Jev: filler (78%)"). Sponsor verdicts are named
  separately, so 🐇 Speed-only mode still cuts them outright. Needs your own
  TypeSafe API key (set in the popup) and works with or without AI highlights —
  Jev decides but never writes, so summaries, chapters, takeaways and mentions
  still come from Claude.
- **AI highlights** — optional: sends the transcript to Claude (your own
  Anthropic API key, set in the popup) to pick the interesting parts and speed
  through the rest. Pick the model in the popup — Haiku 5.5 (default), Haiku
  4.5, or Sonnet (smarter judgment, ~3× cost). Every AI skip carries a short
  reason
  ("AI: sponsor read", "AI: repeats earlier point") shown in the cut list, and
  the panel names the model that made the plan — handy for comparing models.
  Since the transcript is already being analysed, the same call also returns a
  **2-3 sentence summary** of the video, shown at the top of the cut-list panel,
  and **AI chapter markers** — named topical chapters ("Tool 3: Cursor",
  "Pricing comparison") for videos whose creator didn't add any. They appear as
  clickable rows in the panel and as blue ticks on the progress bar, so you can
  jump to (or straight past) any topic. The ⏮/⏭ quick-bar buttons hop through
  them — ⏮ returns to the current chapter's start (again for the previous one),
  ⏭ jumps to the next; on videos without chapters they hop ±60 seconds.
  The panel also lists **Takeaways** (3-6 bullets of the actual conclusions)
  and **Mentioned in this video** — every product/tool/site the speaker
  discusses, linked to its real URL when the description carries one (the
  description is passed to the model alongside the transcript).

Skipped junk jumps silently (with a small toast); dull/off-highlight parts play
at your chosen speed-through rate. Toggle per video with the ✂️ button, or leave
"Enable Auto-Cut" on in the popup to apply automatically.

Cut segments are drawn on the player progress bar — **red** = skipped,
**amber** = sped through. Plans are cached locally per video (3 days) so
re-watching is instant and doesn't re-hit the APIs.

The cut-list panel (opened with the ✂️ button) lists every cut, shows an
estimate of the **time saved** in its summary, and closes on **Esc**. Press
**Shift+C** on a watch page to toggle Auto-Cut without opening the panel.

The panel's **Ignore** button exempts the current video from Auto-Cut
permanently (until un-ignored) — use it for music, where "low engagement"
stretches and lyric transcripts make every cut source misfire. Ignored videos
are never analysed or altered; the ✂️ button shows "Auto-Cut · ignored".

Videos **shorter than 2 minutes** (threshold configurable in the popup; 0
disables) are auto-ignored — nothing worth cutting, and skipping the analysis
also means no transcript scraping on quick clips.

Videos YouTube categorises as **Music** are auto-ignored (toggleable in the
popup) — the ✂️ button shows "Auto-Cut · music" and the panel explains why.
Trailers and teasers are exempt from the auto-ignore even when categorised as
Music (matched by title), since they're regular videos worth cutting.
Un-ignoring a music video from the panel is remembered for that video, so it
gets cut on future visits too.

Transcripts are fetched through YouTube's own `get_transcript` API first (the
same call the transcript panel makes), so the visible panel-scraping fallback —
the thing that could nudge the page — should almost never run.

Coverage note: Auto-Cut can only cut what data exists. Brand-new videos have no
SponsorBlock submissions or "most replayed" data yet, so there's nothing to cut.
The widest-coverage source is **AI highlights**, which works on any video that
has captions.

The "Watch Later: toggle" button adds or removes the **current** video from your
Watch Later playlist in **one click** — it calls YouTube's internal playlist API
directly (no dialog pops up). It remembers per-video state, so the same button
adds the video, then removes it on the next click.

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome (or any Chromium browser: Edge, Brave, etc.).
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select this `youtube-quick-nav/` folder (or run `npm run pack` first and select `dist/unpacked/` to load a lightweight runtime-only directory without `node_modules/`).
5. Open a YouTube video — the button bar appears under the title and the video
   switches to cinema mode.

## Settings

Click the extension's toolbar icon to open the popup. From there you can:

- Toggle **Cinema mode** on/off.
- Show/hide each quick-nav button individually.
- Check the **Anthropic** and **TypeSafe** API keys with the "Test key"
  buttons — one minimal real call each. A successful response confirms the
  test worked; errors and rate limits remain errors, rather than a false
  “key accepted” result. Claude uses the selected model for this check.

Settings and provider keys sync via `chrome.storage.sync`; changes apply
immediately. Refresh open video tabs after reloading/updating the extension.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest, permissions, content script + action popup |
| `cut-controls.js` | Shared presets, saved section actions and playback savings accounting |
| `analysis-engine.js` | Thorough chunking, evidence checks, review reconciliation and local correction suggestions |
| `content.js` | Injects the button bar, drives the Watch Later toggle, enables cinema mode |
| `injected.js` | Page-context helper that calls YouTube's playlist API to add/remove Watch Later |
| `background.js` | Service worker for SponsorBlock and Jev requests |
| `content.css` | Styling for the pills and the toast notification |
| `popup.html` / `popup.js` | Settings popup |
| `icons/` | Toolbar / store icons (16, 48, 128 px) |

## Notes

- Quick-nav links use these YouTube routes: History `/feed/history`,
  Watch Later `/playlist?list=WL`, Subscriptions `/feed/subscriptions`,
  Liked `/playlist?list=LL`, Library `/feed/you`.
- The Watch Later toggle uses YouTube's own InnerTube endpoint
  (`/youtubei/v1/browse/edit_playlist`) with your existing signed-in session —
  the same call YouTube makes when you click its clock icon. You must be signed
  in. The extension shows a toast if it can't complete (e.g. not signed in).
- Membership is tracked locally per video (`chrome.storage.local`). If it ever
  drifts (e.g. you remove a video on another device), one extra click resyncs it.
- SponsorBlock receives a four-character SHA-256 prefix of the video ID when
  messaging cuts are enabled. Optional Claude and Jev analysis sends the
  transcript to the selected provider; Claude also receives the description.
  Provider keys are sent only to their respective service. There is no analytics.

## Packaging for a friend (no keys shared)

Run `npm run pack` to audit every runtime file for hardcoded secrets, stage `dist/unpacked/`, and build a clean shareable archive at `dist/youtube-quick-nav-v1.44.0.zip` (including `HOW-TO-INSTALL.txt`, `Update-Windows.cmd`, and `Update-Mac-Linux.command`). Your personal API keys, notes, and settings live exclusively in Chrome's browser storage (`chrome.storage`), never in the extension files — and if you also share a settings file via **Export backup (.json)** in the popup, `anthropicKey` and `typesafeKey` are automatically stripped on both export and import.

## Development checks

With Node.js installed, run `npm ci`, then `npx playwright install chromium` if
Chromium is not already available. Run `npm run lint`, `npm run check`,
`npm test`, and `npm run test:browser`.

Browser checks load the unpacked extension in a temporary profile with real
media playback and controlled YouTube/provider responses. They never use your
profile, provider keys, or paid API calls.

The preparation suite uses an actual browser window, initially minimised,
because headless Chromium does not implement window minimisation. Its restore
checks briefly restore isolated test windows without requesting focus. Running
that suite requires a graphical desktop (or a virtual display on Linux).

`node tests/live-smoke.cjs` separately checks public YouTube layout, metadata and
real caption retrieval in a temporary signed-out browser. Both AI passes use
intercepted simulated responses and a dummy key; there are no paid calls or
account writes. It requires live network access and is not part of the offline
test suite.
