/* Free cut signals that need no AI: creator chapter names, a per-channel
 * memory of already-cut wording, storyboard stillness, and timestamps from
 * top comments. Pure functions — no DOM, network or storage access. */
(() => {
  'use strict';

  const TS = String.raw`(\d{1,2}:[0-5]\d(?::[0-5]\d)?)`;
  function parseStamp(text) {
    const parts = String(text).split(':').map(Number);
    if (parts.some(n => !Number.isFinite(n))) return NaN;
    return parts.reduce((total, n) => total * 60 + n, 0);
  }

  /* ---------- creator chapter names ---------- */
  // Titles are matched from their start (after numbering/emoji) so "Intro to
  // React" or "Adding sponsors to the database" are not mistaken for labels.
  const CHAPTER_RULES = [
    { re: /^(?:paid\s+)?(?:sponsor(?:ed|ship)?|ad(?:vert(?:isement)?)?(?:\s*(?:break|read|spot))?|promo(?:tion)?|brought to you by)(?![\w-])/i,
      action: 'skip', kind: 'sponsor', sponsor: true, label: 'sponsor', maxSec: 240 },
    { re: /(?:today'?s|this video'?s) sponsor|for sponsoring|sponsor(?:ed)? (?:by|segment|message|spot|read)/i,
      action: 'skip', kind: 'sponsor', sponsor: true, label: 'sponsor', maxSec: 240 },
    { re: /^(?:(?:my|our|the|channel)\s+)?(?:patreon|merch(?:andise)?|shout\s*-?\s*outs?|supporters?|members(?:hip)?|discord|newsletter|support (?:the|this|my) channel|join (?:the|my) (?:channel|discord|community))(?![\w-])/i,
      action: 'skip', kind: 'selfpromo', sponsor: true, label: 'self-promo', maxSec: 240 },
    { re: /^(?:please\s+)?(?:like\s*(?:&|and)\s*)?subscribe(?![\w-])/i,
      action: 'skip', kind: 'interaction', sponsor: true, label: 'subscribe reminder', maxSec: 90 },
    { re: /^(?:intro|outro|end\s*screen|credits|recap|preview|coming up|housekeeping|channel (?:update|news)s?)(?![\w-])(?!\s+(?:to|of|for)\b)/i,
      action: 'speed', kind: 'intro', sponsor: false, label: 'creator-labelled', maxSec: 150 },
  ];
  function chapterTitleRule(title) {
    const clean = String(title || '').normalize('NFKC')
      .replace(/^[^\p{L}]+/u, '').trim();
    if (!clean) return null;
    return CHAPTER_RULES.find(rule => rule.re.test(clean)) || null;
  }
  // Creator chapters (YouTube or description timestamps) whose names say
  // what they are. AI-generated topics are never used: they describe content,
  // they are not the creator's own label.
  function chapterCuts(chapters, duration) {
    const list = (Array.isArray(chapters) ? chapters : [])
      .filter(c => c && Number.isFinite(c.start) && c.source !== 'ai')
      .sort((a, b) => a.start - b.start);
    const out = [];
    list.forEach((c, i) => {
      const rule = chapterTitleRule(c.title);
      if (!rule) return;
      const end = i + 1 < list.length ? list[i + 1].start : duration;
      if (!Number.isFinite(end) || end - c.start < 3) return;
      const long = end - c.start > rule.maxSec;
      // A long "Sponsor" chapter probably runs on into real content: play it
      // fast instead of jumping it. Long "Intro" chapters are left alone.
      if (long && rule.action === 'speed') return;
      const title = String(c.title).trim().slice(0, 60);
      out.push({
        start: c.start, end,
        action: long ? 'speed' : rule.action,
        sponsor: long ? false : rule.sponsor,
        kind: rule.kind,
        reason: `${rule.label} (chapter: ${title})`,
        source: 'chapters',
      });
    });
    return out;
  }

  /* ---------- channel memory of already-cut wording ---------- */
  function words(text) {
    return (String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/\[[^\]]*\]/g, ' ').match(/[\p{L}\p{N}']+/gu) || [])
      .map(w => w.replace(/'/g, '')).filter(Boolean);
  }
  function fnv(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  const SHINGLE = 5;
  // Keep one in four shingles (by hash) so memory stays small; matching
  // samples the current transcript the same way, so coverage ratios hold.
  const sampled = h => (h & 3) === 0;
  // Word stream with the caption line each word came from.
  function wordStream(transcript) {
    const lines = (Array.isArray(transcript) ? transcript : [])
      .filter(t => t && Number.isFinite(+t.start)).sort((a, b) => +a.start - +b.start);
    const stream = [];
    lines.forEach((l, i) => { for (const w of words(l.text)) stream.push({ w, line: i }); });
    return { lines, stream };
  }
  function streamShingles(stream) {
    const out = [];
    for (let i = 0; i + SHINGLE <= stream.length; i++) {
      const h = fnv(stream.slice(i, i + SHINGLE).map(x => x.w).join(' '));
      if (sampled(h)) out.push({ h, line: stream[i].line });
    }
    return out;
  }
  const lineEnd = (lines, i) => {
    const l = lines[i], explicit = +l.end;
    if (Number.isFinite(explicit) && explicit > +l.start) return explicit;
    const next = lines[i + 1] ? +lines[i + 1].start : +l.start + 4;
    return Math.min(next, +l.start + 6);
  };

  const MEMORY_SOURCES = new Set(['sponsorblock', 'chapters', 'thorough', 'ai', 'jev']);
  // Wording from this video's confident cuts, to recognise when the channel
  // repeats it in later videos. Only skips from evidence-based sources count —
  // never speed-ups, heatmap guesses or this memory's own matches. Any reason
  // qualifies: wording a channel repeats verbatim across videos is boilerplate
  // (pitches, intros, sign-offs); real content almost never recurs word for word.
  function memorableSpans(segments, transcript, videoId) {
    const { lines, stream } = wordStream(transcript);
    if (!lines.length) return [];
    const out = [];
    for (const s of Array.isArray(segments) ? segments : []) {
      if (!s || s.action !== 'skip' || !MEMORY_SOURCES.has(s.source)) continue;
      const len = s.end - s.start;
      if (!(len >= 6 && len <= 300)) continue;
      const inside = stream.filter(x => +lines[x.line].start >= s.start - 0.5 && +lines[x.line].start < s.end);
      if (inside.length < 12) continue;
      const hashes = [...new Set(streamShingles(inside).map(x => x.h))].slice(0, 300);
      if (hashes.length < 3) continue;
      out.push({ v: videoId, a: 'skip', s: !!s.sponsor, k: s.kind || '', r: String(s.reason || 'cut').slice(0, 60), h: hashes });
      if (out.length >= 8) break;
    }
    return out;
  }
  // Stretches of this transcript whose wording matches a span this channel
  // has had cut before (in another video).
  function matchMemory(transcript, spans, { videoId = '', minSec = 8, minHits = 4, ratio = 0.6 } = {}) {
    const pool = (Array.isArray(spans) ? spans : []).filter(sp => sp && sp.v !== videoId && Array.isArray(sp.h));
    if (!pool.length) return [];
    const owner = new Map();
    pool.forEach((sp, i) => sp.h.forEach(h => { if (!owner.has(h)) owner.set(h, i); }));
    const { lines, stream } = wordStream(transcript);
    const perLine = lines.map(() => ({ total: 0, hits: 0, by: new Map() }));
    for (const { h, line } of streamShingles(stream)) {
      const slot = perLine[line];
      slot.total++;
      if (owner.has(h)) { slot.hits++; const o = owner.get(h); slot.by.set(o, (slot.by.get(o) || 0) + 1); }
    }
    // A line is matched when most of its sampled shingles hit. Lines too short
    // to carry a sample are neutral; lines with some hits are partial (the
    // edges of a repeated passage, where shingles straddle new speech). Both
    // can bridge or extend a run, but a run must start from a matched line.
    const state = perLine.map(p => (p.total === 0 ? 'neutral' : p.hits / p.total >= ratio ? 'hit' : p.hits ? 'partial' : 'miss'));
    const out = [];
    let i = 0;
    while (i < lines.length) {
      if (state[i] !== 'hit') { i++; continue; }
      let j = i, lastHit = i;
      while (j + 1 < lines.length && state[j + 1] !== 'miss') { j++; if (state[j] !== 'neutral') lastHit = j; }
      while (i > 0 && state[i - 1] === 'partial') i--;
      const run = perLine.slice(i, lastHit + 1);
      const hits = run.reduce((a, p) => a + p.hits, 0), total = run.reduce((a, p) => a + p.total, 0);
      const start = +lines[i].start, end = lineEnd(lines, lastHit);
      if (end - start >= minSec && hits >= minHits && hits / Math.max(1, total) >= 0.5) {
        const votes = new Map();
        run.forEach(p => p.by.forEach((n, o) => votes.set(o, (votes.get(o) || 0) + n)));
        const top = pool[[...votes.entries()].sort((a, b) => b[1] - a[1])[0][0]];
        out.push({
          start, end, action: top.a || 'skip', sponsor: !!top.s, kind: top.k || 'repeat',
          reason: `repeat of this channel's ${top.r.replace(/^(?:AI|Jev|Thorough):\s*/i, '')}`.slice(0, 80),
          source: 'channel-memory',
          evidence: lines.slice(i, lastHit + 1).map(l => l.text).join(' ').slice(0, 120),
        });
      }
      i = lastHit + 1;
    }
    return out;
  }
  // Add a video's spans to the stored memory, bounded by channels, videos per
  // channel and total stored hashes (oldest first out).
  function rememberSpans(memory, channelId, videoId, spans, now = Date.now(),
    { maxVideos = 15, maxChannels = 60, maxHashes = 120000 } = {}) {
    const mem = memory && typeof memory === 'object' && memory.channels ? memory : { channels: {} };
    if (!channelId || !videoId) return mem;
    const ch = mem.channels[channelId] || { t: now, videos: {} };
    if (spans.length) ch.videos[videoId] = { t: now, spans };
    else delete ch.videos[videoId];
    const vids = Object.entries(ch.videos).sort((a, b) => b[1].t - a[1].t).slice(0, maxVideos);
    ch.videos = Object.fromEntries(vids);
    ch.t = now;
    if (vids.length) mem.channels[channelId] = ch; else delete mem.channels[channelId];
    const channels = Object.entries(mem.channels).sort((a, b) => b[1].t - a[1].t);
    let budget = maxHashes;
    mem.channels = {};
    for (const [id, c] of channels.slice(0, maxChannels)) {
      const size = Object.values(c.videos).reduce((n, v) => n + v.spans.reduce((m, sp) => m + sp.h.length, 0), 0);
      if (size > budget) break;
      budget -= size;
      mem.channels[id] = c;
    }
    return mem;
  }
  function channelSpans(memory, channelId) {
    const ch = memory?.channels?.[channelId];
    return ch ? Object.values(ch.videos).flatMap(v => v.spans || []) : [];
  }

  /* ---------- storyboard stillness ---------- */
  // YouTube's seek-preview sprite sheets: "base|w#h#count#cols#rows#ms#name#sigh|…".
  function parseStoryboardSpec(spec, duration) {
    const parts = String(spec || '').split('|');
    if (parts.length < 2 || !/^https:\/\/i\.ytimg\.com\//.test(parts[0])) return [];
    return parts.slice(1).map((p, level) => {
      const f = p.split('#');
      const [width, height, count, cols, rows] = f.slice(0, 5).map(Number);
      if (f.length < 8 || ![width, height, count, cols, rows].every(n => Number.isFinite(n) && n > 0)) return null;
      const perSheet = cols * rows, sheets = Math.ceil(count / perSheet);
      const url = parts[0].replace('$L', String(level)).replace('$N', f[6]) + (f[7] ? `&sigh=${encodeURIComponent(f[7])}` : '');
      return {
        level, width, height, count, cols, rows, perSheet,
        interval: duration > 0 ? duration / count : (Number(f[5]) || 0) / 1000,
        sheetUrls: Array.from({ length: sheets }, (_, j) => url.replace('$M', String(j))),
      };
    }).filter(l => l && l.interval > 0);
  }
  // Smallest level with real frames for stillness; sharpest ≤160px for AI.
  function pickLevels(levels) {
    const usable = levels.filter(l => l.count >= 10 && l.width >= 48).sort((a, b) => a.width - b.width);
    const analysis = usable.find(l => l.width >= 64) || usable[0] || null;
    const vision = [...usable].reverse().find(l => l.width <= 160) || analysis;
    return { analysis, vision };
  }
  function frameDiffs(signatures) {
    return signatures.map((sig, i) => {
      if (!i || !sig || !signatures[i - 1]) return NaN;
      const prev = signatures[i - 1];
      let sum = 0;
      for (let k = 0; k < sig.length; k++) sum += Math.abs(sig[k] - prev[k]);
      return sum / sig.length;
    });
  }
  // Time ranges with captions: speech, or at least on-screen words being read.
  function speechRanges(transcript) {
    const { lines } = wordStream(transcript);
    return lines.filter(l => words(l.text).length).map((l, i) => [+l.start, lineEnd(lines, i)]);
  }
  function uncovered(start, end, ranges) {
    const out = [];
    let cursor = start;
    for (const [a, b] of ranges) {
      if (b <= cursor) continue;
      if (a >= end) break;
      if (a > cursor) out.push([cursor, a]);
      cursor = Math.max(cursor, b);
    }
    if (cursor < end) out.push([cursor, end]);
    return out;
  }
  // Frozen picture AND no captions: a loading screen, render wait or held
  // title card. Speeds those up. Frozen pictures with talking (slides, a
  // still talking head) are left alone — that is where the content is.
  // Uncaptioned stretches whose picture keeps changing are returned as
  // `gaps` for an optional AI look; nothing decides those locally.
  function visualSignals({ signatures, interval, transcript, duration, stillDiff = 2.5, minStill = 15, minGap = 20 }) {
    const speech = speechRanges(transcript);
    if (!speech.length || !Array.isArray(signatures) || signatures.length < 3 || !(interval > 0)) return { segments: [], gaps: [] };
    const diffs = frameDiffs(signatures);
    const segments = [], stillRanges = [];
    let i = 1;
    while (i < diffs.length) {
      if (!(diffs[i] <= stillDiff)) { i++; continue; }
      let j = i;
      while (j + 1 < diffs.length && diffs[j + 1] <= stillDiff) j++;
      const start = (i - 1) * interval, end = Math.min(duration || Infinity, (j + 1) * interval);
      if (end - start >= minStill) stillRanges.push([start, end]);
      i = j + 1;
    }
    for (const [a, b] of stillRanges) {
      for (const [s, e] of uncovered(a, b, speech)) {
        if (e - s >= 12) segments.push({ start: s, end: e, action: 'speed', kind: 'static', sponsor: false,
          reason: 'frozen screen, no talking', source: 'visual' });
      }
    }
    const gaps = [];
    for (const [gs, ge] of uncovered(0, duration || speech.at(-1)[1], speech)) {
      // Frozen parts are already decided above; only moving pictures need a look.
      for (const [s, e] of uncovered(gs, ge, stillRanges)) {
        if (e - s >= minGap) gaps.push({ start: s, end: e, times: [0.15, 0.4, 0.65, 0.9].map(f => s + (e - s) * f) });
      }
    }
    return { segments, gaps: gaps.sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 6).sort((a, b) => a.start - b.start) };
  }
  const VISUAL_VERDICTS = {
    waiting: { reason: 'waiting / loading screen (AI saw it)' },
    filler: { reason: 'B-roll filler, no talking (AI saw it)' },
    demo: { reason: 'silent demo — played at 2× (AI saw it)', rateCap: 2 },
  };
  function visualVerdictSegments(gaps, verdicts) {
    const out = [];
    for (const v of Array.isArray(verdicts) ? verdicts : []) {
      const gap = gaps[v?.id], rule = VISUAL_VERDICTS[v?.verdict];
      if (!gap || !rule) continue;
      out.push({ start: gap.start, end: gap.end, action: 'speed', kind: v.verdict, sponsor: false,
        reason: rule.reason, source: 'visual', ...(rule.rateCap ? { rateCap: rule.rateCap } : {}) });
    }
    return out;
  }
  const visualSchema = {
    type: 'object', additionalProperties: false, required: ['gaps'],
    properties: { gaps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'verdict'],
      properties: { id: { type: 'integer' }, verdict: { type: 'string', enum: ['waiting', 'filler', 'demo', 'unclear'] } } } } },
  };

  /* ---------- top-comment timestamps ---------- */
  const SPONSOR_WORDS = /\b(?:sponsor(?:ed|ship)?s?|ads?|advert\w*|promo(?:tion)?|segment)\b/i;
  const RANGE_RE = new RegExp(`${TS}\\s*(?:-|–|—|to|until|till|through)\\s*${TS}`, 'gi');
  const INTRO_RE = new RegExp(String.raw`(?:skip(?:\s+(?:ahead|forward))?(?:\s+(?:to|the\s+intro(?:\s+(?:to|at))?))?|(?:actual|real)\s+(?:video|content)\s+(?:starts?|begins?)(?:\s+at)?|(?:video|content)\s+(?:actually\s+)?(?:starts?|begins?)(?:\s+at)?|tl;?dw)\s*[:\-@]?\s*` + TS, 'i');
  const weight = likes => 1 + (likes >= 5 ? 1 : 0) + (likes >= 50 ? 1 : 0);
  function cluster(items, tol) {
    const groups = [];
    for (const it of [...items].sort((a, b) => a.a - b.a)) {
      const g = groups.find(x => Math.abs(x.a - it.a) <= tol && Math.abs((x.b ?? 0) - (it.b ?? 0)) <= tol);
      if (g) { g.items.push(it); g.w += it.w; } else groups.push({ a: it.a, b: it.b, w: it.w, items: [it] });
    }
    // Agreeing viewers differ by a few seconds: cover all of their range, and
    // take the earliest "starts at" so no content is skipped.
    for (const g of groups) {
      g.a = Math.min(...g.items.map(x => x.a));
      if (g.b !== undefined) g.b = Math.max(...g.items.map(x => x.b));
    }
    return groups;
  }
  // Viewer-supplied sponsor ranges and "video starts at" times. One comment
  // only earns a speed-up; agreement (or a well-liked comment) earns a skip.
  // Frequently cited single moments are kept at normal speed.
  function commentSignals(comments, duration) {
    const sponsors = [], intros = [], moments = [];
    for (const c of Array.isArray(comments) ? comments : []) {
      const text = String(c?.text || '').slice(0, 2000), w = weight(Number(c?.likes) || 0);
      const used = new Set();
      if (SPONSOR_WORDS.test(text)) {
        for (const m of text.matchAll(RANGE_RE)) {
          const a = parseStamp(m[1]), b = parseStamp(m[2]);
          if (b - a >= 5 && b - a <= 300 && b <= duration) { sponsors.push({ a, b, w }); used.add(m[1]); used.add(m[2]); }
        }
      }
      const intro = text.match(INTRO_RE);
      if (intro) {
        const t = parseStamp(intro[1]);
        if (t >= 15 && t <= Math.min(360, duration * 0.3)) { intros.push({ a: t, w }); used.add(intro[1]); }
      }
      for (const m of text.matchAll(new RegExp(TS, 'g'))) {
        const t = parseStamp(m[1]);
        if (!used.has(m[1]) && t > 0 && t < duration - 10) moments.push({ a: t, w });
      }
    }
    const out = [];
    for (const g of cluster(sponsors, 8)) {
      const strong = g.w >= 2;
      out.push({ start: g.a, end: g.b, action: strong ? 'skip' : 'speed', sponsor: strong, kind: 'sponsor',
        reason: `sponsor (${g.items.length > 1 ? `${g.items.length} viewers'` : 'a viewer\'s'} timestamps)`, source: 'comments' });
    }
    const intro = cluster(intros, 10).sort((x, y) => y.w - x.w)[0];
    if (intro) {
      out.push({ start: 0, end: intro.a, action: intro.w >= 2 ? 'skip' : 'speed', sponsor: false, kind: 'intro',
        reason: `intro — viewers say it starts at ${Math.floor(intro.a / 60)}:${String(Math.round(intro.a % 60)).padStart(2, '0')}`,
        source: 'comments' });
    }
    for (const g of cluster(moments, 12).filter(g => g.w >= 3).sort((x, y) => y.w - x.w).slice(0, 4)) {
      out.push({ start: Math.max(0, g.a - 3), end: Math.min(duration, g.a + 25), action: 'keep', sponsor: false, kind: 'highlight',
        reason: 'moment viewers point to in comments', source: 'comments' });
    }
    return out;
  }

  globalThis.YqnSignals = {
    parseStamp, chapterTitleRule, chapterCuts,
    words, memorableSpans, matchMemory, rememberSpans, channelSpans,
    parseStoryboardSpec, pickLevels, frameDiffs, visualSignals, visualVerdictSegments, visualSchema,
    commentSignals,
  };
})();
