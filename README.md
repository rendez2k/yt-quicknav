# YouTube Quick Nav + Cinema

A Chrome (Manifest V3) extension that:

- Adds a row of quick-access pill buttons under the video title on YouTube watch pages:
  **History · Watch Later · Subscriptions · Liked · Library · Like · Watch Later: toggle · Copy Link · Peak**
- Auto-opens videos in **cinema (theater) mode**.

The **Copy Link** button copies a shareable URL to the current video **at the
current playback time** (`…/watch?v=…&t=123s`) to your clipboard in one click.

The **🔥 Peak** button jumps to the **most-replayed moment** using YouTube's own
"most replayed" graph — press it again to hop to the next hot spot (top 5).
There's nothing to jump to on videos without "most replayed" data yet.

The **Like** and **Watch Later: toggle** action buttons colour themselves
**green when active** (liked / in Watch Later) and **red when not**.

## Auto-Cut

The **✂️ Auto-Cut** button trims a video "more or less live": it analyses the
video once, then during playback **skips** the junk and **speeds through** the
dull parts. Sources (each toggleable in the popup):

- **Skip messaging** — SponsorBlock community data: auto-skips sponsor reads,
  subscribe/like reminders, intros, outros, self-promo (and speeds through
  tangents/filler). Only a privacy-preserving hash of the video ID is sent to
  `sponsor.ajay.app`.
- **Trim dull parts** — uses YouTube's own "most replayed" graph to speed
  through low-engagement stretches. No third-party service.
- **AI highlights** — optional: sends the transcript to Claude (your own
  Anthropic API key, set in the popup) to pick the interesting parts and speed
  through the rest.

Skipped junk jumps silently (with a small toast); dull/off-highlight parts play
at your chosen speed-through rate. Toggle per video with the ✂️ button, or leave
"Enable Auto-Cut" on in the popup to apply automatically.

Cut segments are drawn on the player progress bar — **red** = skipped,
**amber** = sped through. Plans are cached locally per video (3 days) so
re-watching is instant and doesn't re-hit the APIs.

The cut-list panel (opened with the ✂️ button) lists every cut, shows an
estimate of the **time saved** in its summary, and closes on **Esc**. Press
**Shift+C** on a watch page to toggle Auto-Cut without opening the panel.

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
4. Select this `youtube-quick-nav/` folder.
5. Open a YouTube video — the button bar appears under the title and the video
   switches to cinema mode.

## Settings

Click the extension's toolbar icon to open the popup. From there you can:

- Toggle **Cinema mode** on/off.
- Show/hide each quick-nav button individually.

Settings sync via `chrome.storage.sync` and apply immediately (reload an open
video if it doesn't update instantly).

## Files

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest, permissions, content script + action popup |
| `content.js` | Injects the button bar, drives the Watch Later toggle, enables cinema mode |
| `injected.js` | Page-context helper that calls YouTube's playlist API to add/remove Watch Later |
| `content.css` | Styling for the pills and the toast notification |
| `popup.html` / `popup.js` | Settings popup |
| `icons/` | Toolbar / store icons (16, 48, 128 px) |

## Notes

- Quick-nav links use these YouTube routes: History `/feed/history`,
  Watch Later `/playlist?list=WL`, Subscriptions `/feed/subscriptions`,
  Liked `/playlist?list=LL`, Library `/feed/library`.
- The Watch Later toggle uses YouTube's own InnerTube endpoint
  (`/youtubei/v1/browse/edit_playlist`) with your existing signed-in session —
  the same call YouTube makes when you click its clock icon. You must be signed
  in. The extension shows a toast if it can't complete (e.g. not signed in).
- Membership is tracked locally per video (`chrome.storage.local`). If it ever
  drifts (e.g. you remove a video on another device), one extra click resyncs it.
- Only `https://www.youtube.com/*` is requested; no analytics or third-party
  calls — the only network request is to YouTube itself.
