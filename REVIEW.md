# Workflow review — 12 October 2026

Updated the unpacked extension from **1.35.0 to 1.35.1**. This folder has no Git
repository. Original source snapshots are kept in `.review-baseline/`.

## Findings and fixes

| Priority | Finding | Result |
|---|---|---|
| High | Fresh analysis referenced undefined `aiIncomplete` before announcing and drawing the plan. This throws even with debug logging off because arguments are evaluated first. Cached plans took another path, explaining intermittent behaviour. | Removed the broken completion path; fresh and cached plans share publication logic. Reproduced against the original code. |
| High | Merging skips retained only the first reason. An intro could absorb a sponsor; Speed-only then converted the whole interval to speed. Jev also merged junk and sponsor verdicts by action alone. | Split at source boundaries, prioritise sponsor skips, retain sponsor identity and Jev reasons. Reproduced the intro/sponsor failure against the original code. |
| High | SponsorBlock waited behind transcript retrieval and AI before any cuts became active. | Publish available sponsor cuts immediately; add the remaining results when ready. |
| High | Navigation, changing settings and Ignore could leave older asynchronous work able to change current state. Requests were correlated only by video ID. | Each analysis has a generation check; bridge requests have unique IDs; repeated requests are deduplicated; stale results cannot publish. |
| Medium | The controller hooked one video element once, listened only for time updates, and restored every speed-up to 1×. | Reattach after media replacement; handle seeks/play/metadata changes plus a bounded polling interval; restore the viewer's original speed. |
| Medium | Missing markers after DOM replacement, panels closing during ordinary metadata updates, and panels overflowing below the viewport. | Recover markers, preserve the open panel and scroll position, fit it above/below the button as space permits. |
| Medium | Source errors could look like “nothing to cut”; partial plans had no retry control. Cache entries had no settings fingerprint. | Show source failures and partial coverage, offer a real cache-bypassing retry, avoid caching incomplete plans, and match cached plans to analysis settings. |
| Medium | Popup speed changes discarded all cached analysis. API-key tests marked arbitrary HTTP errors as success. | Reapply speed-only/rate locally; key tests require a successful response and use the selected Claude model. |
| Medium | SponsorBlock used page-origin requests; a lost Jev worker response could replay a paid request. | Route SponsorBlock/Jev through the permitted worker with deadlines and allowed hosts. Do not replay paid POSTs after ambiguous responses. Keep the existing browser-compatible Claude request in the tab with a deadline so long analyses do not depend on worker lifetime. |
| Medium | External cut reasons were inserted as HTML. Duplicate AI highlights could inflate coverage. | Render reasons as text; measure bounded, merged highlight coverage. |

Short-video checks now use a player response identified as the current video,
avoiding the previous video's duration on a reused media element. Captured
transcripts are scoped to their video/navigation. Peak jumps abandon stale
responses after navigation.

## Validation

Version 1.35.1 result: static analysis and syntax checks passed, all **7 regression
tests** passed, and all **15 browser workflow cases** passed (the Node runner
also counts the enclosing browser suite as a sixteenth test).

- `npm run lint`: checks undefined identifiers, unreachable code and duplicate keys.
- `npm run check`: JavaScript syntax checks for all four runtime scripts.
- `npm test`: seven regression cases for plan completion, sponsor priority,
  speed restoration, stale work, cancellation, segment bounds and AI coverage.
- `npm run test:browser`: the unpacked MV3 extension is loaded in an isolated
  Chromium profile. Tests exercise both content-script worlds, service-worker
  messaging, real storage, popup controls and actual media playback.
- Browser cases cover fresh markers and panel, sponsor skipping, continuous
  playback into a sponsor, speed-only behaviour, video/progress-bar replacement,
  navigation and cleanup, same-video metadata updates, upstream errors/retry,
  immediate settings changes, delayed transcript retrieval/deduplication,
  structured Claude output, failed Claude output with working sponsor cuts,
  Jev sponsor/junk boundaries, Ignore/override persistence and API-key test errors.
- Manifest remains V3, permissions have not expanded, and the 16/48/128 icons
  exist with the correct dimensions.
- A public SponsorBlock hash-prefix GET returned HTTP 200 and the expected JSON
  structure. The sample video had no matching row; this verifies reachability,
  not sponsor coverage for the user's videos.

`tests/workflow.png` shows the corrected panel and markers on the controlled
browser page. Browser responses are fixtures, and **no paid AI requests were
made**. The normal browser automation tool could not start due to a Windows
sandbox setup error, so the user's signed-in YouTube Premium session was not
tested or modified. Real YouTube transcript/layout changes and provider account
availability remain outside the evidence of this local suite. Like/Watch Later
account writes were source-reviewed, not performed against the user's account.

The extension depends on SponsorBlock submissions or enabled analysis sources;
an unsubmitted sponsor read cannot be guaranteed to be detected. Missing data is
distinct from a failed request in the UI.

## Feature update — 1.36.0

Implemented all five requested additions: replay the last skipped section once,
saved channel preferences, persistent Keep/Speed/Skip section edits, live playback
status with actual viewing savings, and Sponsors only/Gentle trim/Quick watch
presets. The README describes how these interact and where they are stored.

Important implementation details:

- Personal section choices apply after the preset and survive re-analysis, even
  if a source later omits the saved range. They never rewrite cached source data.
- Cut rows, markers and the button count update together. Keeping every section
  removes markers but leaves all section controls accessible.
- Channel preferences load before cuts can run, use verified current-video
  player metadata, and cannot contain provider credentials. Global off still
  overrides a remembered channel-on setting.
- Replay bypasses the skipped interval once and joins consecutive skip fragments
  into one replayable section. Pausing and seeking do not inflate time saved;
  replay refunds the original skip credit.
- Presets share one policy between the popup and in-video panel. Existing AI
  switches and credentials are untouched. No permissions were added.

Feature verification uses the same isolated Chromium workflow described above,
with additional cases for all section actions/reset/reload, retained kept rows,
all presets, natural playback and replay, saved-time accounting, channel-ID
separation and navigation, global master off, and desktop/390px panel layouts.
Final 1.36.0 result: lint and syntax checks passed, all **16 unit/regression
tests** passed and all **20 browser workflow cases** passed (21 including the
enclosing suite). Version consistency, unchanged permissions, referenced script
paths and whitespace checks also passed.

The new controls were also inspected in rendered desktop and narrow screenshots.
This remains fixture-backed evidence, not a live test of the user's Premium
account or paid providers.

## Thorough analysis — 1.37.0 (30 October 2026)

Implemented overlapping whole-transcript review, a dedicated sponsor/boundary
verification pass, evidence-anchored cuts, conflict protection, content-led
trimming and local channel learning. The mode is opt-in and uses already-enabled
Claude analysis. Provider settings and keys are preserved; no permissions were
added. Jev remains available in Standard mode and now sends complete evidence
for each batch instead of asking about windows beyond its truncated input.

Thorough results use caption IDs, retain provided end times, combine duplicate
timestamps, require real source quotes for cuts and keep ambiguous/unreviewed
material. Coverage is measured in caption lines, not claimed video comprehension.
Community sponsors remain active while the longer review runs. Only successful
complete results enter the cache. A forced retry invalidates older cached results
before fetching, preventing failed refreshes from silently restoring an old plan.

Learning records category/action corrections by channel ID. At least three
distinct videos with consistent choices are needed for a suggestion. Suggested
rules require the user's Apply action and can be paused/reset. Per-video edits
remain authoritative. Learning records are local and are never included in
provider requests.

Validation exercises chunk boundaries, transcripts over the previous 300k cap,
fabricated quotes, disagreement, caption gaps, duplicate timestamps, cancellation,
partial failure, truncated output, cache/retry, chapter/resource metadata and local
learning. The installed-extension browser workflow additionally exercises actual
media playback through a newly detected sponsor, replay, source conflicts, saved
plans, popup/panel settings and three-video suggestion/apply/reset flows.

Final result: **31 unit/regression tests** and **27 browser workflow cases**
passed (the browser runner reports 28 including its enclosing suite). Lint,
syntax, version consistency, permission comparison, referenced-script and
whitespace checks passed.

A separate live smoke check used the public “Me at the zoo” watch page in a
temporary signed-out Chromium profile. It verified the real page title, channel,
19.021-second media duration, toolbar/panel and caption retrieval. Three real
caption lines reached both simulated AI passes; the panel reported 3/3 checked,
1/1 section finished, with no page errors. All Anthropic traffic in that check
was intercepted and answered with fixtures; no real keys or paid calls were used.
This verifies the live transport and UI, not model accuracy or the user's signed-in
Premium session.

The live check exposed a separate toolbar mounting problem around late YouTube
metadata/layout changes. The bar now recovers after title replacement and uses
either visible metadata host without discarding the current cut plan. A browser
regression confirms recovery, a single toolbar and no extra analysis request.
Screenshots are in `tests/thorough-desktop.png`, `tests/thorough-mobile.png` and
`tests/live-smoke.png`.

## Video tools and approval — 1.38.0 (30 October 2026)

Built all six requested additions: local missed-sponsor marking/preview, safe
diagnostic reports, AI usage and budgets, caption-grounded video questions,
timestamped bookmarks/notes with export, and review-before-applying cuts.
New scripts are loaded by the existing MV3 manifest without added permissions.
The pre-change snapshot is `.tools-baseline-1.37.0/` (this folder has no Git repo).

Playback consumes only approved segments while review mode is enabled; proposed
rows and striped markers remain visible. Approval resets on reload, re-analysis
or changed cut actions/bounds. A range preview bypasses existing cuts and stays
paused at its end, including when that end falls inside a known sponsor. Notes
use a separate drawer so cut-list refreshes do not destroy drafts.

All paid transports use a shared budget reservation helper. The worker serialises
updates and persists reservations before dispatch. Token usage replaces estimates;
lost/aborted responses remain charged as estimates rather than being silently
treated as free. Budgets cover extension requests only and are not invoice caps.
Unknown Jev pricing is explicit and cannot bypass an enabled budget. No keys,
transcripts or question text enter accounting records or diagnostic exports.

Questions send caption evidence only after an explicit Ask action. Long transcripts
are searched locally for bounded excerpts, with a partial-context notice. Every
returned citation must match an exact supplied caption quote/ID; invalid evidence
and missing coverage produce an honest fallback. Citation existence validates
grounding and timestamps, not semantic accuracy of every generated statement.

Validation: **43 unit/regression tests**, **35 installed-extension browser cases**
(36 including the enclosing suite), syntax and lint passed. Checks exercise native
media playback, proposal approval/invalidation/reload, preview end behaviour,
manual cut persistence/removal, notes create/edit/export/delete, supported/missing/
fabricated citations, diagnostic clipboard content, small-screen layout, daily and
video budgets, concurrent reservations, worker restart, unknown usage, pre-dispatch
cancellation, interrupted questions, and budget exhaustion between Thorough passes.
The clipboard test compares parsed JSON because Windows normalises line endings.

The updated live smoke check passed on the public “Me at the zoo” page in a
temporary signed-out profile: real 19.021-second media, caption retrieval, both
Thorough passes, a cited question response, one saved bookmark and a diagnostic
report, with no page errors. All three AI calls were intercepted with simulated
responses; no paid requests or real credentials were used. This verifies the
workflow and live YouTube integration, not a measured sponsor-detection or Q&A
accuracy rate. Desktop/narrow screenshots were visually inspected; artifacts are
`tests/review-before-apply.png`, `tests/video-tools-desktop.png`,
`tests/video-tools-mobile.png` and `tests/live-smoke.png`.

## Missing timeline markers and premature empty verdict — 1.38.1 (31 October 2026)

The reported “AI found no clear junk or filler” message could be emitted on
Thorough progress updates, before the reviewer had finished. The empty-result
logic also ignored Thorough/Jev failures and conflated kept overrides with no
detections. Progress now refreshes the panel/markers without announcing a final
verdict; completion announces once, after the planning flag clears. Failures,
missing data and overrides have distinct messages. Standard AI output with no
usable section classifications is rejected rather than silently treated as an
empty successful plan. The AI cut counter excludes Keep rows.

Marker recovery previously tested DOM existence and duration only. A node could
remain attached to a hidden, clipped or superseded timeline. The overlay now
lives directly under the video player and tracks the visible seek slider's
position, width, height and opacity. It ignores hidden duplicates, recovers on
player/slider replacement and follows resize/control visibility without blocking
native seeking. Root z-order keeps the strip above native track backgrounds.

Validation: 46 unit/regression tests and 37 installed-extension browser cases
(38 including the enclosing suite) passed. New checks cover provisional-result
announcements, failure/override explanations, unusable AI output, clipped progress
internals, hidden duplicate sliders, slider resizing and control hide/show.

The supplied public video `mSjlmpGH6Is` was inspected in a disposable signed-out
Chromium profile. Its 162 prepared caption lines include explicit sponsor reads
around 13:00 and 17:16; the community lookup returned no matching submissions.
Ten simulated requests exercised the five Thorough sections without a paid call.
Synthetic local ranges then verified visible red/amber markers on the real
YouTube timeline. The screenshot `tests/video-diagnostic.png` was visually checked.
These synthetic ranges verify rendering, not the accuracy of the user's four
AI-generated cuts. Public transcript/layout diagnostics are in an ignored local
JSON artifact; no real keys or user profile data were accessed.

The live run also demonstrated fallback caption recovery after missing page data;
the new status exposed that source warning even though caption review completed.
No claim is made that the user's exact signed-in browser state was reproduced.

## Caption provenance and topic navigation — 1.38.3 (2 November 2026)

On supplied video `YxxD1-9EW3I`, the generic engagement-panel timestamp scraper
returned seven chapter headings as though they were spoken captions. Thorough
analysis could therefore report a completed review of the wrong input. The
fallback now reads only recognised classic transcript rows or modern
`transcript-segment-view-model` rows, excluding accessibility timestamp labels.
The live check now reads 63 speech-caption entries, including sponsorship
disclosures. Unsupported layouts report unavailable captions. Cache V13 drops
plans produced by the old reader without changing keys or saved preferences.

Equivalent Unicode punctuation no longer invalidates a verbatim evidence quote.
Paraphrases, missing words and fabricated quotes remain rejected. Per-caption
audit counters distinguish deliberate keeps from low certainty, disagreement,
quote mismatches, missing/overlapping reviews and invalid ranges. The copied
diagnostic report allowlists numeric counters and does not include caption text.

On supplied Android-apps video `TYNzg59ke30`, navigation previously depended on
AI chapters and ignored 16 existing YouTube chapters. A shared pure topic parser
now reads the current player's chapter data or a strictly ordered description
timeline. It excludes recommendation-card chapters and checks video identity
before using page globals. Native topics are loaded with existing video metadata
and remain usable with Auto-Cut/AI off or while analysis runs. Verified AI topics
are the fallback and now publish progressively. Topics are never used as caption
evidence or as an instruction to cut substantive content.

The Topics drawer offers direct, previous and next jumps and highlights the
current topic. It preserves other drawer drafts and closes on video navigation.
The existing player overlay also draws topic ticks independently of Auto-Cut.
Skip/speed totals and pending/incomplete state appear in the drawer; the cut
panel explicitly explains a result with no speed-up sections. Verified speed
sections still restore the viewer's original playback rate on exit or a topic jump.

Live validation used an isolated signed-out Chromium profile and simulated AI
responses. The Android video supplied 107 prepared speech-caption entries and
all 16 native topics; clicking Next at 107 seconds moved to 113.05 seconds,
Scroll Light. Six intercepted provider calls exercised three Thorough sections.
There were no page errors and no paid requests. The screenshot
`tests/topics-TYNzg59ke30.png` shows the live topic drawer before synthetic marker
ranges were added. Synthetic cuts only validate overlay placement, not detection.

Validation: **53 unit/regression tests** and **43 installed-extension browser
cases** (44 including the enclosing suite) passed, along with syntax and lint.
New cases cover chapter-only panels, modern speech rows and their cleanup,
verification diagnostics, topic navigation with AI/Auto-Cut off, current/previous/
next jumps, SPA replacement without stale topics, native topics during analysis,
and speed restoration when jumping to another topic. The manifest remains MV3;
all referenced files/icons exist and permissions are unchanged. No user browser
profile or real credentials were accessed. The unapplied intermediate caption
fix was numbered 1.38.2; this release includes it in 1.38.3. Backups are in
`.verification-baseline-1.38.1/` and `.topic-baseline-1.38.2/`.

## Speed-through suppression — 1.38.4 (3 November 2026)

The user reported that speed-through sections had nearly disappeared. The
Thorough prompt limited speed to clear repetition while broadly requiring
demonstrations/explanations to stay normal. The reconciler also applied the same
high-certainty and identical-kind requirement to speed as to skipping. A draft
labelling a speed passage `repetition` and a review calling it `explanation`
therefore reverted it to Keep even when both actions and quotes agreed. Finally,
`autoCutPlus` was not passed into Thorough analysis: Quick watch changed the
settings/cache but did not change its pacing instructions. Regression cases
reproduced the category rejection and missing pacing input before modification.

Both passes now receive balanced or quick pacing instructions. Balanced pacing
includes recaps, padding, repeated examples and low-information transitions;
Quick also considers narrated routine setup and extended detail after the core
explanation. Key facts, first demonstrations and essential instructions remain
normal. No heatmap-only fallback overrides a reviewed Keep or an unknown gap.

Speed acceptance now requires two grounded speed actions with medium/high
certainty and does not require identical kind labels. Low/invalid confidence,
missing evidence, overlapping/missing reviews and Keep/speed disagreements still
retain the passage. Skip acceptance remains high-certainty, with matching
categories for non-sponsor skips; the existing high-certainty sponsor-review
discovery path is unchanged. Diagnostics split speed/skip proposals and accepts.

Cache V14 invalidates results produced by the older policy. Existing settings,
credentials, edits and channel preferences are not rewritten. The two-pass
request count, permissions and provider switches are unchanged. Backups are in
`.pacing-baseline-1.38.3/`. Browser tests simulate provider classifications; prompt
changes have not been evaluated against a paid live model or the user's active
profile, so no real-world speed coverage percentage is claimed.

Validation: **56 unit/regression tests**, **45 installed-extension browser
cases** (46 including the enclosing suite), syntax and lint all passed. New
coverage checks mismatched category labels, medium-confidence speed agreement,
low/invalid confidence and fabricated evidence rejection, unchanged skip rules,
both pacing prompts, visible amber markers, rate restoration, Quick/Gentle
switching, cache reuse, persistent Keep overrides and separate diagnostic counts.

## Truncated early sections — 1.38.5 (3 November 2026)

The user's live VIVO review (`9KaD6bM1OFs`) showed nine adjustments clustered
after 10:04. Read-only inspection of the installed extension's panel confirmed
**63/288 caption lines checked** and `max_tokens` failures for sections 1 and 2.
The panel still said 3/3 sections finished. This explained both the lost early
speed-ups and wasted processing; the user confirmed markers were present.

Thorough grouping previously limited input by time and character count but not
the number of classifications needed. It now caps each core at 40 caption lines
and context at eight lines per side, retaining the existing time/character caps.
Both passes request compact grouped decisions and shorter supporting text.
Only a response explicitly stopped by the provider's output limit triggers
splitting and fresh two-pass verification of the smaller cores. Lost network
requests, budget errors and refusals do not trigger this recovery. There are at
most three splits, at most two levels deep, within the existing 60-section and
120-attempt ceiling. Cancellation and the shared spending ledger still apply.

Successful child cores replace the failed parent exactly once in coverage and
audit totals; unverified regions remain at normal speed. Partial results still
publish progressively and incomplete plans remain uncached. The UI now says
sections processed, and safe diagnostics include checked/total coverage,
recovery count and allowlisted failure time ranges/phases/codes. Settings,
permissions and the V14 successful-plan cache are unchanged. Backups are in
`.response-baseline-1.38.4/`.

Validation: **61 unit/regression tests**, **46 installed-extension browser
cases** (47 including the enclosing suite), syntax and lint passed. New checks
cover dense 288-line input, draft and review truncation recovery, unique caption
coverage, bounded persistent failures, cancellation, non-retryable errors,
privacy-safe diagnostics, early amber markers and actual faster playback,
original-rate restoration and recovered-plan cache reuse. Browser provider
responses were simulated. After the user reloaded, live coverage reached
288/288 across eight sections and produced 25 speed ranges, including the early
review. That establishes restored coverage, not a precise latency benchmark.
Browser control blocks `chrome://extensions`, so the user performed the reload.

## Preparation, parallel checking and commercial self-promotion — 1.38.7

The user identified an own-store promotion near 1:21 in the VIVO review. Its
captions introduce the creator's import store and what it sells. Thorough's
sponsor policy now explicitly covers commercial self-promotion without an
outside sponsor, coupon or purchase link. Mere ownership disclosures and actual
review facts remain protected; cutting still requires grounded caption evidence.
V15 invalidates the earlier policy's cache. The intermediate prompt/concurrency
work was numbered 1.38.6; this release includes it and the background queue.

Foreground analysis runs at most two sections concurrently, with each review
strictly after its own draft. Recovery shares the same total request allowance,
reserves capacity for pending reviews and cannot publish duplicate caption
coverage. Background analysis uses one section at a time. Existing budget
reservations still serialise across tabs. Cache writes/removals now serialise in
the worker too, so two videos cannot overwrite each other's cache entries.

The user chose five videos every 30 minutes. The opt-in Watch Later queue uses
Chrome alarms and a single owned, inactive, muted tab. Its assignment is persisted
before navigation, and the content helper asks the extension worker to verify tab
ownership; a URL parameter alone cannot authorise work. It collects only playlist
video links, filters IDs, excludes already open videos and valid prepared plans,
and runs the existing analysis with channel/ignore settings. Complete plans are
saved before closing the tab. Incomplete/interrupted work has a one-day cooldown;
a budget stop ends the batch. At most five videos are attempted per batch.
Only owned tabs can report completion; closing, navigating or activating a
preparation tab stops or releases it without touching unrelated tabs. A watchdog
recovers after worker suspension; unknown/lost paid work is not replayed.

The popup and Auto-Cut panel offer automatic preparation, Prepare now, Stop and
status. Scheduling needs only the added `alarms` permission; existing YouTube host
access covers tab queries. No new hosts, keys or paid providers are enabled.
The playlist is not edited and queue metadata stays local. Page visits can affect
YouTube/browser history even though background media is held paused and muted.

Validation: **68 unit/regression tests** and **51 installed-extension browser
cases** (53 including two enclosing suites). The original 46 browser cases pass
with concurrent sections. Five new browser cases cover the complete five-video
queue, next-batch deduplication, cache reuse on normal playback, own-store skips
in speed-only mode, speed restoration, pre-dispatch budget stops, cancellation
and preserving unrelated tabs. Provider replies in automated tests are simulated.
Concurrency/cancellation, ownership checks, restart recovery, cache-write races,
interrupted-work cooldown and the 30-minute schedule have unit coverage.

Live 1.38.7 verification after reload reached 261/261 captions on the VIVO video
(this run used YouTube's transcript endpoint rather than the 288-line player
capture). It produced 18 speed ranges and skipped the later store pitch, but kept
the opening 1:19–1:27 as a neutral ownership disclosure. The user's explicit
correction was saved as a local Skip; the prompt improvement is not a guarantee
that every model run recognises this ambiguous wording.

The additional reported video `Nj7rnWJE92o` completed 243/243 caption lines and
automatically marked the Super Thanks/Discord appeal at 8:05–8:26 as Skip. A
live cached-playback check started inside the appeal at 8:06 and reached 8:28;
the UI reported the cached plan and 20 seconds saved. No provider call was
required for that replay. Automatic preparation was enabled through its checkbox.
Its first batch stopped when the preparation tab was activated, exercising the
user-takeover safeguard; a manual restart reached “Preparing video 1 of at most
5”. No live performance percentage or guaranteed detection accuracy is claimed.

## Live queue recovery — 1.38.8 (3 November 2026)

The live preparation batch reached its first video but was then reported as
interrupted. Ownership previously required the temporary query marker to remain
in the URL, which is not stable through YouTube canonical redirects/SPA updates.
The worker now verifies its persisted assigned tab ID, HTTPS YouTube origin and
the exact expected video ID or Watch Later destination. The content helper asks
for its assigned role even after a redirect removed that marker. Arbitrary tabs,
different videos and unrelated sites still cannot claim or complete the job.

The installed-browser fixture now removes the marker from both playlist and
watch destinations before document start, testing the entire flow under that
condition without sending redirected fixture requests to real YouTube.
A test race was also fixed: the job is deliberately persisted before navigation,
so the test must await the actual page before inspecting its paused media.
Interrupted work now has the same one-day cooldown as failed work. Initial alarm
delay is 30 minutes; enabling still starts a batch immediately, without allowing
a short initial alarm to start a second batch moments later.

Promotion instructions clarify that describing a creator-owned store's offerings
takes precedence over the general reviewer-background rule, and explicitly
include donations/Super Thanks and promoted community benefits. V15 caches remain
usable; refinements run on new analysis/Re-analyse, and the user's specific VIVO
correction remains saved locally. This avoids unnecessary repeat paid analyses.
Backups are in `.queue-baseline-1.38.7/`.

Final validation: **69 unit/regression tests**, **51 installed-extension browser
cases** (53 with enclosing suites), syntax, lint, manifest file/version checks
and whitespace checks passed. The queue suite was re-run after fixing its page-
readiness race and canonical-destination fixture. The live donation result is
captured in `tests/donation-skip-live.png`. The schedule is enabled in the user's
settings; activating the final queue recovery code still requires reloading the
extension to 1.38.8. A post-reload live queue completion has not yet been verified.

## Viewing during preparation — 1.38.9 (3 November 2026)

After the user loaded 1.38.8, the live queue reached its first video, then reported
that activation of the preparation tab had stopped it. Whether the user selected
the tab or Chrome activated it was not established. Cancelling work just to view
progress is unnecessarily disruptive, so video activation now retains the
existing analysis and queue. Its tab is marked as viewer-owned, unmuted and
released from the pause guard; completion and cancellation never close that tab.
The assignment remains persisted across a service-worker restart. The temporary
playlist still stops collecting if opened, to avoid scrolling under the user.

Thorough analysis reports the title and checked/total caption lines to the queue
status. Only the assigned video can update that status; counts and title length
are bounded, and no transcript text is stored in it. No additional AI passes,
permissions or cache invalidation were introduced. The pre-change files are in
`.takeover-baseline-1.38.8/`.

Validation passed: **72 unit/regression tests**, **52 installed-extension browser
cases** (54 including enclosing suites), syntax, lint, manifest paths/version and
whitespace checks. The queue browser test activates the first preparation video,
observes caption progress, verifies playback is released, completes all five
plans with exactly ten simulated provider calls, and checks skip/speed playback
in the retained tab. A race test ensures a late role reply cannot reapply the
pause guard after activation. These tests use isolated profiles and simulated
provider replies. The live five-video queue has not yet completed under 1.38.9;
loading it in the user's Chrome requires an extension reload.

## Playlist activation recovery — 1.38.10 (3 November 2026)

The user confirmed the extension card showed 1.38.9 and said they had not noticed
another tab. The live check still reported the old cancellation text, which in
1.38.9 exists only in the playlist-activation branch. A second attempt stopped
while its preparation tabs were left untouched. This establishes that playlist
activation must not be treated as intentional cancellation; it does not establish
why Chrome activated the page. Earlier suspicion about an old installed version
was not confirmed. A video inspected during the first attempt showed 40/348
captions checked, but its queue status did not show caption progress. Live queue
completion and progress reporting therefore remain unverified.

All preparation-tab activation now keeps the job running and preserves the tab
for viewing. An active playlist waits for its entries to render, collects those
already loaded, and performs no further scrolling. It relinquishes its helper
role after submitting them, so subsequent normal browsing does not retain the
preparation role. No extra AI requests, permissions or cache invalidation are
introduced. Backups are in `.playlist-baseline-1.38.9/`.

Validation passed: **73 unit/regression tests**, **six queue browser cases**
(seven including their enclosing test), syntax and lint. The browser scenario
activates both the temporary playlist and first video, then verifies all five
plans complete with exactly ten simulated provider calls and both viewed tabs
remain open. Unit coverage includes delayed playlist rendering and activation
during collection without additional scrolling. The 46 other browser cases
passed on 1.38.9; playback code is unchanged in this patch.

After the user loaded 1.38.10, a live batch started at approximately 14:52 UTC.
The status showed advancing caption coverage and then "Open for viewing"
without cancellation. The first video, `CFY_gHuMhUU`, completed 545/545 caption
lines across 14/14 sections, retaining seven uncertain decisions. The queue
reported one ready and automatically started `Wv-OCRWmhS4`, subsequently observed
at 280/348 lines. The first result took about seven minutes on this single run;
no general processing-time improvement is claimed.

Opening the first video in a separate test tab displayed "Auto-Cut ready
(cached): 3 skip, 26 speed" immediately. All 29 matching timeline markers were
present. Clicking its 0:47–1:40 sponsor range jumped to 1:40; the 2:16–2:23 speed
range showed 1.5× playback, then normal playback resumed. Automatic preparation
of up to five videos every 30 minutes remains enabled and the live batch was
left running. This live check covers the first completion and automatic advance;
the full five-item queue was verified with controlled responses in the browser
test. Screenshots: `tests/queue-activation-continues-live.png`,
`tests/queue-advance-live.png`, and `tests/prepared-playback-live.png`.

## Separate minimised preparation window — 1.38.11 (3 November 2026)

The user reported the normal preparation tabs appearing among their browsing
tabs and requested a separate minimised window. Each batch now creates one
unfocused, minimised window with one muted, paused tab and reuses that tab for
the playlist and all queued videos. Finishing, stopping or hitting a spending
limit closes only the still-owned quiet tab (and therefore its empty window).
The extension does not fall back to creating tabs in a normal browsing window
if window creation fails.

Chrome selects the sole tab in a minimised window. That event is now ignored as
a takeover; actual restoration, focus or moving the tab releases it for viewing.
A restored window, moved tab, or window containing additional tabs is preserved,
and subsequent work gets a new minimised window. IDs and the between-video
parked job are persisted so a worker restart can continue without replaying the
completed request. No permissions, analysis inputs, settings keys or cache
formats changed. Existing in-flight jobs from the previous version finish in
place before subsequent videos move to the new window.

Reusing a tab adds a stale-message hazard: an old document can send a completion
while Chrome reports the next pending URL. Sender authentication now uses the
actual sending document URL and ignores that pending URL. A regression test
checks that the late completion cannot finish the next video.

Validation passed: **78 unit/regression tests**, **52 browser cases** (54 with
enclosing suites), syntax, lint, manifest paths/version, icon sizes, unchanged
permissions and whitespace checks. The window suite first exposed that headless Chromium
reports normal windows regardless of minimisation. The suite now uses an
isolated real Chromium window, initially minimised, and asserts actual state,
unchanged original-window focus, one reused tab for all five fixture videos,
automatic window closure, restored-page preservation, cached playback, budget
stopping and cancellation. Provider responses are controlled; no paid calls or
user-profile access are used. Retained tabs are also explicitly released from
the pause guard when additional tabs prevent automatic cleanup. Backups
are in `.window-baseline-1.38.10/`. User-profile validation requires loading 1.38.11.

## Reload

Reload **YouTube Quick Nav + Cinema** in `chrome://extensions`, then refresh
every open YouTube tab. Open Auto-Cut to see the cuts and any source warnings.
Red means skipped; amber means sped up. Re-analyse fetches a fresh plan and may
use configured paid providers.

## References checked

- [Chrome cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests): content scripts retain page-origin restrictions; worker requests use host permissions.
- [SponsorBlock API documentation](https://wiki.sponsor.ajay.app/w/API_Docs): hash-prefix lookup and segment response format.
- [Chrome service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle): fetch responses taking over 30 seconds can terminate a worker; long Claude requests stay in the tab.
- [Chrome alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms): periodic checks, sleep behaviour and recreating alarms after restart.
- [Chrome tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs): inactive tab creation, muting and tab queries using existing host access.
- [Chrome windows](https://developer.chrome.com/docs/extensions/reference/api/windows): minimised unfocused creation and focus/bounds events, checked for 1.38.11.
