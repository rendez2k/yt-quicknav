/* Shared playback policy. No DOM, network or account access. */
(() => {
  'use strict';
  const presets = {
    custom: { label: 'Custom', description: 'Use your individual settings.', patch: {} },
    sponsors: { label: 'Sponsors only', description: 'Skip promotions from enabled sources. Keep other sections.',
      patch: {cutMessaging: true, cutBoring: false, autoCutPlus: false, speedOnly: false, speedRate: 3} },
    gentle: { label: 'Gentle trim', description: 'Skip promotions; play other detected cuts at 2×.',
      patch: {cutMessaging: true, cutBoring: true, autoCutPlus: false, speedOnly: true, speedRate: 2} },
    quick: { label: 'Quick watch', description: 'Speed through routine detail at 3×, keeping key explanations normal. Includes Thorough pacing review.',
      patch: {cutMessaging: true, cutBoring: true, autoCutPlus: true, speedOnly: false, speedRate: 3} },
    tldr: { label: 'TL;DR (highlights only)', description: 'Skip routine detail, filler and promotions so only core points and peaks play.',
      patch: {cutMessaging: true, cutBoring: true, autoCutPlus: true, speedOnly: false, speedRate: 4} },
  };
  const preferenceKeys = ['autoCut', 'cutPreset', 'thoroughAnalysis', 'reviewBeforeApply', 'learnCorrections', 'cutMessaging', 'cutBoring', 'autoCutPlus',
    'cutSilence', 'speedOnly', 'speedRate', 'autoIgnoreMusic', 'minCutMinutes', 'autoAdvancePlaylist'];
  const presetKeys = ['cutMessaging', 'cutBoring', 'autoCutPlus', 'speedOnly', 'speedRate'];
  const sponsorPattern = /sponsor|self-?promo|merch|newsletter|membership|patreon|discord|course|subscribe|bell|\bad(vert)?\b/i;
  const defaults = {
    cinemaMode: true,
    volumeBoost: 100,
    volumeLevel: false,
    showHistory: true,
    showWatchLater: true,
    showSubscriptions: true,
    showLiked: true,
    showLibrary: true,
    showLike: true,
    showToggle: true,
    showCopyLink: true,
    showPeak: true,
    showJump: true,
    showSpeed: true,
    showLoop: true,
    showScreenshot: true,
    showCut: true,
    showTldr: true,
    tldrDepth: 'balanced',
    showVolume: true,
    showTools: true,
    showThumbBadges: true,
    showRealRemaining: true,
    cleanEndscreen: true,
    redirectShorts: false,
    autoAdvancePlaylist: true,
    autoCut: false,
    cutPreset: 'custom',
    thoroughAnalysis: false,
    watchLaterPrepare: false,
    prepareBatchSize: 0,
    reviewBeforeApply: false,
    aiDailyBudget: 0,
    aiVideoBudget: 0,
    jevInputPrice: 0,
    learnCorrections: true,
    cutMessaging: true,
    cutBoring: true,
    autoCutPlus: false,
    cutSilence: false,
    speedOnly: false,
    autoIgnoreMusic: true,
    minCutMinutes: 2,
    aiHighlights: false,
    anthropicKey: '',
    aiModel: 'claude-haiku-5-5',
    jevCuts: false,
    typesafeKey: '',
    speedRate: 3,
    shortcutsEnabled: true,
    debug: false,
  };
  function fmtStamp(sec) {
    const s = Math.max(0, Math.round(+sec || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rem = s % 60;
    return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(rem).padStart(2, '0');
  }
  function normalizeBaseSpeed(rate) {
    const n = Number(rate);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(Math.max(0.5, Math.min(4, n)) * 100) / 100;
  }
  const QUICK_SPEED_STEPS = [1, 1.25, 1.5, 1.75, 2];
  function cycleQuickSpeed(currentRate) {
    const r = Number.isFinite(+currentRate) && +currentRate > 0 ? +currentRate : 1;
    if (r >= 1.98) return 1;
    const next = QUICK_SPEED_STEPS.find(step => step > r + 0.02);
    return next || 1;
  }
  function stepQuickSpeed(currentRate, deltaSteps = 1) {
    const r = Number.isFinite(+currentRate) && +currentRate > 0 ? +currentRate : 1;
    const steps = Number.isFinite(+deltaSteps) && +deltaSteps !== 0
      ? (Math.trunc(+deltaSteps) || Math.sign(+deltaSteps))
      : 0;
    return Math.max(0.5, Math.min(3, Math.round((r + steps * 0.1) * 100) / 100));
  }
  function shouldAutoAdvancePlaylist({ autoAdvancePlaylist = true, listId = '', playing = false, duration = 0, seg = null, alreadyAdvanced = false } = {}) {
    if (autoAdvancePlaylist === false || alreadyAdvanced || !playing) return false;
    if (typeof listId !== 'string' || !listId.trim()) return false;
    const dur = Number(duration);
    if (!Number.isFinite(dur) || dur < 15) return false;
    if (!seg || seg.action !== 'skip' || !Number.isFinite(+seg.start) || !Number.isFinite(+seg.end)) return false;
    return +seg.end - +seg.start >= 2 && +seg.end >= dur - 3;
  }
  function computeThumbnailBadge({ durationSec = 0, segments = [], poiHighlights = [], speedRate = 3, prepared = false } = {}) {
    const dur = Number.isFinite(+durationSec) && +durationSec > 0 ? +durationSec : 0;
    const rate = Math.max(1.25, Math.min(4, +speedRate || 3));
    const clamped = (Array.isArray(segments) ? segments : [])
      .filter(s => s && (s.action === 'skip' || s.action === 'speed') && Number.isFinite(+s.start) && Number.isFinite(+s.end) && +s.end > +s.start)
      .map(s => ({
        start: Math.max(0, +s.start),
        end: dur > 0 ? Math.min(dur, +s.end) : +s.end,
        action: s.action,
      }))
      .filter(s => s.end > s.start);
    let saved = 0;
    if (clamped.length) {
      const edges = [...new Set(clamped.flatMap(s => [s.start, s.end]))].sort((a, b) => a - b);
      for (let i = 0; i < edges.length - 1; i++) {
        const a = edges[i], b = edges[i + 1];
        const matching = clamped.filter(s => s.start <= a && s.end >= b);
        if (!matching.length) continue;
        if (matching.some(s => s.action === 'skip')) saved += (b - a);
        else saved += (b - a) * (1 - 1 / rate);
      }
    }
    const savedSec = Math.max(0, Math.round(saved));
    const effectiveSec = dur > 0 ? Math.max(1, Math.round(dur - saved)) : 0;
    const validPois = (Array.isArray(poiHighlights) ? poiHighlights : [])
      .map(p => Number.isFinite(+p) ? +p : +p?.start)
      .filter(t => Number.isFinite(t) && t >= 0 && (!dur || t <= dur))
      .sort((a, b) => a - b);
    const hasPoi = validPois.length > 0;
    let label = '', title = '';
    if (dur > 0 && savedSec >= 5) {
      label = `${prepared ? '⚡ ' : ''}→ ${fmtStamp(effectiveSec)}`;
      title = `${prepared ? 'Prepared · ' : ''}Effective runtime ${fmtStamp(effectiveSec)} (saves ${fmtStamp(savedSec)})${hasPoi ? ` · ★ highlight at ${fmtStamp(validPois[0])}` : ''}`;
    } else if (!dur && savedSec >= 5) {
      label = `${prepared ? '⚡ ' : ''}−${fmtStamp(savedSec)}`;
      title = `${prepared ? 'Prepared · ' : ''}Saves ~${fmtStamp(savedSec)} of cuts${hasPoi ? ` · ★ highlight at ${fmtStamp(validPois[0])}` : ''}`;
    } else if (prepared) {
      label = '⚡ Ready';
      title = `Auto-Cut plan cached and ready${hasPoi ? ` · ★ highlight at ${fmtStamp(validPois[0])}` : ''}`;
    } else if (hasPoi) {
      label = `★ ${fmtStamp(validPois[0])}`;
      title = `Community highlight at ${fmtStamp(validPois[0])}`;
    }
    return { savedSec, effectiveSec, hasPoi, prepared: !!prepared, label, title };
  }
  function presetPatch(id) {
    return {cutPreset: presets[id] ? id : 'custom', ...(presets[id]?.patch || {})};
  }
  function cleanEdits(edits) {
    return (Array.isArray(edits) ? edits : []).filter(e => e && Number.isFinite(e.start) &&
      Number.isFinite(e.end) && e.start >= 0 && e.end > e.start && ['keep','speed','skip'].includes(e.action))
      .map(({start,end,action}) => ({start,end,action})).slice(-500);
  }
  function editRange(edits, start, end, action) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return cleanEdits(edits);
    const out = [];
    for (const e of cleanEdits(edits)) {
      if (e.end <= start || e.start >= end) { out.push(e); continue; }
      if (e.start < start) out.push({...e,end:start});
      if (e.end > end) out.push({...e,start:end});
    }
    if (['keep','speed','skip'].includes(action)) out.push({start,end,action});
    return out.sort((a,b) => a.start-b.start);
  }
  function applyEdits(raw, edits, settings, learned = {}) {
    const clean = raw.filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
    const personal = cleanEdits(edits);
    const edges = [...new Set([...clean, ...personal].flatMap(s => [s.start,s.end]))].sort((a,b) => a-b);
    const out = [];
    for (let i=0;i<edges.length-1;i++) {
      const start=edges[i], end=edges[i+1];
      const source=clean.find(s => s.start <= start && s.end >= end);
      const edit=personal.find(s => s.start <= start && s.end >= end);
      if (!source && !edit) continue;
      const sponsor=source && (source.sponsor ?? sponsorPattern.test(source.reason || ''));
      let action=source?.action || 'keep';
      if (settings.cutPreset === 'sponsors' && !sponsor) action='keep';
      else if (settings.cutPreset === 'tldr' && !settings.speedOnly && action === 'speed') action='skip';
      else if (settings.speedOnly && action === 'skip' && !sponsor) action='speed';
      const defaultAction=action;
      const kind=globalThis.YqnAnalysis?.kindOf(source || {}) || source?.kind;
      const learnedAction=learned?.[kind];
      if (['keep','speed','skip'].includes(learnedAction)) action=learnedAction;
      if (edit) action=edit.action;
      const row={...source,start,end,action,defaultAction:learnedAction || defaultAction,edited:!!edit,
        learned:!edit && learnedAction ? `${learnedAction} ${kind}` : '',reason:source?.reason || 'Your saved section'};
      const last=out[out.length-1];
      if (last && last.end === start && last.action === action && last.reason === row.reason &&
        last.defaultAction === row.defaultAction && last.edited === row.edited && last.kind === row.kind &&
        last.learned === row.learned && last.evidence === row.evidence) {
        if (Number.isFinite(last.wpm) && Number.isFinite(row.wpm)) {
          const prevDur = last.end - last.start, addDur = end - start;
          last.wpm = Math.round((last.wpm * prevDur + row.wpm * addDur) / (prevDur + addDur));
        }
        last.end=end;
      }
      else out.push(row);
    }
    return out;
  }
  function sameCutIdentity(a, b) {
    return !!(a && b && a.action === b.action && a.reason === b.reason &&
      Boolean(a.sponsor) === Boolean(b.sponsor) && a.kind === b.kind &&
      a.source === b.source && a.evidence === b.evidence);
  }
  function coalesceMicroGaps(segments) {
    if (!Array.isArray(segments) || segments.length < 2) return Array.isArray(segments) ? segments : [];
    // Drop unverified, unprotected micro-keeps sandwiched between two matching cuts
    // so playback rate does not whipsaw 3x -> 1x -> 3x across a brief breath.
    const filtered = [];
    for (let i = 0; i < segments.length; i++) {
      const cur = segments[i];
      const prev = filtered[filtered.length - 1];
      const next = segments[i + 1];
      if (cur && cur.action === 'keep' && !cur.verified && !cur.protect && prev && next) {
        const dur = cur.end - cur.start;
        if (prev.action === 'speed' && next.action === 'speed' && dur <= 2.0 &&
            Math.abs(cur.start - prev.end) < 0.05 && Math.abs(next.start - cur.end) < 0.05) {
          continue;
        }
        if (prev.action === 'skip' && next.action === 'skip' && dur <= 1.0 &&
            Math.abs(cur.start - prev.end) < 0.05 && Math.abs(next.start - cur.end) < 0.05) {
          continue;
        }
      }
      filtered.push({ ...cur });
    }
    const out = [];
    for (const seg of filtered) {
      const prev = out[out.length - 1];
      if (!prev) {
        out.push(seg);
        continue;
      }
      const gap = seg.start - prev.end;
      const maxBridge = prev.action === 'skip' && seg.action === 'skip' ? 1.0
        : prev.action === 'speed' && seg.action === 'speed' ? 2.0 : -1;
      if (maxBridge > 0 && gap >= 0 && gap <= maxBridge) {
        if (sameCutIdentity(prev, seg)) {
          if (Number.isFinite(prev.wpm) && Number.isFinite(seg.wpm)) {
            const d1 = Math.max(0.1, prev.end - prev.start), d2 = Math.max(0.1, seg.end - seg.start);
            prev.wpm = Math.round((prev.wpm * d1 + seg.wpm * d2) / (d1 + d2));
          }
          prev.end = seg.end;
          continue;
        }
        if (gap > 0) prev.end = seg.start;
      } else if (gap === 0 && sameCutIdentity(prev, seg)) {
        prev.end = seg.end;
        continue;
      }
      out.push(seg);
    }
    return out;
  }
  function annotateSpeechDensity(segments, transcript) {
    if (!Array.isArray(segments) || !segments.length || !Array.isArray(transcript) || !transcript.length) {
      return segments;
    }
    const rawLines = transcript
      .filter(t => t && Number.isFinite(+t.start))
      .sort((a, b) => +a.start - +b.start);
    if (!rawLines.length) return segments;
    const lines = rawLines.map((t, i) => {
      const start = +t.start;
      const dur = Number.isFinite(+t.duration) && +t.duration > 0 ? +t.duration : 0;
      const end = dur > 0
        ? start + dur
        : i + 1 < rawLines.length
          ? Math.max(start + 0.5, Math.min(+rawLines[i + 1].start, start + 6))
          : start + 4;
      const words = (String(t.text || '').trim().match(/\S+/g) || []).length;
      return { start, end, words };
    });
    return segments.map(s => {
      if (!s || (s.action !== 'speed' && (s.action !== 'skip' || s.sponsor)) ||
          !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.end - s.start < 3) {
        return s;
      }
      let wordSum = 0;
      for (const l of lines) {
        if (l.end <= s.start) continue;
        if (l.start >= s.end) break;
        if (!l.words) continue;
        const overlap = Math.max(0, Math.min(s.end, l.end) - Math.max(s.start, l.start));
        if (overlap > 0) wordSum += l.words * (overlap / Math.max(0.5, l.end - l.start));
      }
      const wpm = Math.round((wordSum / (s.end - s.start)) * 60);
      return { ...s, wpm };
    });
  }
  function resolveSpeedRate(seg, baseRate = 1, configuredRate = 3, maxEffectiveWpm = 420) {
    const base = Number.isFinite(+baseRate) && +baseRate > 0 ? +baseRate : 1;
    const target = Math.max(1.25, Math.min(4, +configuredRate || 3));
    let rate = target;
    if (seg && Number.isFinite(seg.wpm)) {
      if (seg.wpm > 0 && seg.wpm * rate > maxEffectiveWpm) {
        rate = Math.max(1.25, Math.floor((maxEffectiveWpm / seg.wpm) * 4) / 4);
      } else if (seg.wpm <= 18 && Number.isFinite(seg.start) && Number.isFinite(seg.end) &&
          seg.end - seg.start >= 6 && target >= 2.5) {
        rate = Math.min(4, Math.round((target + 0.5) * 4) / 4);
      }
    }
    return Math.max(base, rate);
  }
  function effectiveSpeedEnd(seg, segments, leadOutSec = 0.22) {
    if (!seg || seg.action !== 'speed' || !Number.isFinite(seg.start) || !Number.isFinite(seg.end)) {
      return seg?.end ?? 0;
    }
    if (leadOutSec <= 0 || seg.end - seg.start < 2.0) return seg.end;
    const followedByCut = Array.isArray(segments) && segments.some(other =>
      other && other !== seg && (other.action === 'skip' || other.action === 'speed') &&
      Math.abs(other.start - seg.end) <= 0.08
    );
    if (followedByCut) return seg.end;
    return Math.max(seg.start + 0.5, Math.round((seg.end - leadOutSec) * 1000) / 1000);
  }
  function nextBoundaryDelayMs(time, rate, segments, replaySection = null) {
    if (!Number.isFinite(time)) return null;
    let nextT = Infinity;
    const consider = candidate => {
      if (Number.isFinite(candidate) && candidate > time + 0.005 && candidate < nextT) nextT = candidate;
    };
    if (replaySection && time >= replaySection.start - 0.25 && time < replaySection.end) {
      consider(replaySection.end);
    } else if (Array.isArray(segments)) {
      for (const s of segments) {
        if (!s || !Number.isFinite(s.start) || !Number.isFinite(s.end)) continue;
        if (s.action === 'speed') {
          const end = effectiveSpeedEnd(s, segments);
          if (s.start > time + 0.005) consider(s.start);
          else if (time >= s.start && time < end) consider(end);
        } else if (s.action === 'skip') {
          if (s.start > time + 0.005) consider(s.start);
        }
      }
    }
    if (!Number.isFinite(nextT)) return null;
    const ms = ((nextT - time) / Math.max(0.25, +rate || 1)) * 1000;
    return Math.max(12, Math.min(2000, Math.round(ms)));
  }
  function isTimeBuffered(buffered, targetTime, tolerance = 0.05) {
    if (!buffered || typeof buffered.length !== 'number' || !Number.isFinite(targetTime)) return false;
    try {
      for (let i = 0; i < buffered.length; i++) {
        if (targetTime >= buffered.start(i) - tolerance && targetTime <= buffered.end(i) + tolerance) return true;
      }
    } catch {
      return false;
    }
    return false;
  }
  function shouldBurstShortSkip(seg, currentTime, buffered, playing) {
    if (!playing || !seg || seg.action !== 'skip' || seg.sponsor || !Number.isFinite(currentTime)) return false;
    const remaining = seg.end - currentTime;
    if (remaining <= 0 || remaining > 3.5) return false;
    if (!buffered || typeof buffered.length !== 'number' || buffered.length === 0) return false;
    return isTimeBuffered(buffered, currentTime, 0.25) && !isTimeBuffered(buffered, seg.end, 0.05);
  }
  function formatSkipToast({ skippedSec = 0, reason = '', landedTime = 0, chapters = [], shortcutsEnabled = true } = {}) {
    const secs = Math.max(0, Math.round(+skippedSec || 0));
    const durText = secs >= 60
      ? `${Math.floor(secs / 60)}m${secs % 60 ? ' ' + (secs % 60) + 's' : ''}`
      : secs >= 1 ? `${secs}s` : '';
    const cleanReason = String(reason || '').trim();
    let topicTitle = '';
    if (Array.isArray(chapters) && chapters.length && Number.isFinite(landedTime)) {
      const active = [...chapters]
        .filter(c => c && Number.isFinite(+c.start) && +c.start > 0 && +c.start <= landedTime + 1 && typeof c.title === 'string' && c.title.trim())
        .sort((a, b) => +a.start - +b.start)
        .pop();
      if (active) {
        const rawTitle = active.title.trim();
        topicTitle = rawTitle.length > 32 ? rawTitle.slice(0, 31).trimEnd() + '…' : rawTitle;
      }
    }
    let msg = 'Skipped';
    if (durText && cleanReason) msg += ` ${durText} · ${cleanReason}`;
    else if (durText) msg += ` ${durText}`;
    else if (cleanReason) msg += ` ${cleanReason}`;
    if (topicTitle) msg += ` → ${topicTitle}`;
    if (shortcutsEnabled !== false) msg += ' · Shift+Z undo';
    return msg;
  }
  const SAVINGS_BUCKETS = ['skip', 'speed', 'silence', 'reel'];
  function localDayKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function cleanSavingsCounts(raw) {
    const out = { skip: 0, speed: 0, silence: 0, reel: 0 };
    if (!raw || typeof raw !== 'object') return out;
    for (const k of SAVINGS_BUCKETS) {
      const v = Number(raw[k]);
      if (Number.isFinite(v) && v > 0) out[k] = Math.round(v * 100) / 100;
    }
    return out;
  }
  function recordLifetimeSavings(rawStore, delta, { dayStr = localDayKey(), videoId = '' } = {}) {
    const base = rawStore && typeof rawStore === 'object' && !Array.isArray(rawStore) ? rawStore : {};
    const total = cleanSavingsCounts(base.total);
    const byDay = {};
    if (base.byDay && typeof base.byDay === 'object' && !Array.isArray(base.byDay)) {
      for (const [d, val] of Object.entries(base.byDay)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) byDay[d] = cleanSavingsCounts(val);
      }
    }
    const validDay = /^\d{4}-\d{2}-\d{2}$/.test(String(dayStr || '')) ? String(dayStr) : localDayKey();
    const curDay = byDay[validDay] ? { ...byDay[validDay] } : { skip: 0, speed: 0, silence: 0, reel: 0 };
    let positiveDelta = 0;
    if (delta && typeof delta === 'object') {
      for (const k of SAVINGS_BUCKETS) {
        const d = Number(delta[k]);
        if (!Number.isFinite(d) || d === 0) continue;
        if (d > 0) positiveDelta += d;
        total[k] = Math.round(Math.max(0, total[k] + d) * 100) / 100;
        curDay[k] = Math.round(Math.max(0, curDay[k] + d) * 100) / 100;
      }
    }
    byDay[validDay] = curDay;
    const sortedDays = Object.keys(byDay).sort();
    while (sortedDays.length > 90) {
      const oldest = sortedDays.shift();
      delete byDay[oldest];
    }
    let videosCount = Number.isFinite(+base.videosCount) && +base.videosCount >= 0 ? Math.floor(+base.videosCount) : 0;
    const recentVideos = (Array.isArray(base.recentVideos) ? base.recentVideos : [])
      .filter(id => typeof id === 'string' && /^[\w-]{6,30}$/.test(id))
      .slice(-300);
    if (positiveDelta > 0 && typeof videoId === 'string' && /^[\w-]{6,30}$/.test(videoId) && !recentVideos.includes(videoId)) {
      recentVideos.push(videoId);
      while (recentVideos.length > 300) recentVideos.shift();
      videosCount += 1;
    }
    return { version: 1, total, byDay, videosCount, recentVideos };
  }
  function summarizeLifetimeSavings(rawStore, todayStr = localDayKey()) {
    const clean = recordLifetimeSavings(rawStore, null, { dayStr: todayStr });
    const sumObj = obj => SAVINGS_BUCKETS.reduce((s, k) => s + (Number(obj?.[k]) || 0), 0);
    const todaySec = Math.round(sumObj(clean.byDay[todayStr]));
    let weekRaw = 0;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(todayStr || ''));
    if (m) {
      const anchor = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      for (let i = 0; i < 7; i++) {
        const d = new Date(anchor);
        d.setDate(anchor.getDate() - i);
        weekRaw += sumObj(clean.byDay[localDayKey(d)]);
      }
    } else {
      weekRaw = todaySec;
    }
    const allTimeSec = Math.max(todaySec, Math.round(weekRaw), Math.round(sumObj(clean.total)));
    return {
      todaySec,
      weekSec: Math.round(weekRaw),
      allTimeSec,
      videosCount: clean.videosCount,
      breakdown: {
        skip: Math.round(clean.total.skip),
        speed: Math.round(clean.total.speed),
        silence: Math.round(clean.total.silence),
        reel: Math.round(clean.total.reel),
      },
    };
  }
  class SavingsTracker {
    constructor() {
      this.total = 0;
      this.previous = null;
      this.breakdown = { skip: 0, speed: 0, silence: 0, reel: 0 };
      this.pending = { skip: 0, speed: 0, silence: 0, reel: 0 };
      this.lastSkipBucket = 'skip';
    }
    resetSample() { this.previous = null; }
    sample({ time, now, paused, seeking, rate, baseRate, sped, silent = false, element }) {
      const p = this.previous;
      if (p && p.element === element && p.sped && !p.paused && !paused && !seeking && !p.seeking) {
        const elapsed = (now - p.now) / 1000, moved = time - p.time;
        if (elapsed > 0 && elapsed <= 2 && moved > 0 && moved <= elapsed * p.rate * 1.3 + 0.05) {
          const gain = Math.max(0, moved / p.baseRate - moved / p.rate);
          if (gain > 0) {
            const bucket = p.silent ? 'silence' : 'speed';
            this.total += gain;
            this.breakdown[bucket] += gain;
            this.pending[bucket] += gain;
          }
        }
      }
      this.previous = { time, now, paused, seeking, rate, baseRate, sped, silent: !!silent, element };
    }
    skip(seconds, baseRate, playing, kind = 'skip') {
      const credit = playing ? Math.max(0, seconds) / Math.max(0.1, baseRate) : 0;
      if (credit > 0) {
        const bucket = kind === 'reel' ? 'reel' : 'skip';
        this.lastSkipBucket = bucket;
        this.total += credit;
        this.breakdown[bucket] += credit;
        this.pending[bucket] += credit;
      }
      this.resetSample();
      return credit;
    }
    refund(credit) {
      const c = Number.isFinite(+credit) && +credit > 0 ? +credit : 0;
      const actual = Math.min(this.total, c);
      if (actual > 0) {
        const bucket = this.breakdown[this.lastSkipBucket] >= actual ? this.lastSkipBucket : 'skip';
        this.total = Math.max(0, this.total - actual);
        this.breakdown[bucket] = Math.max(0, this.breakdown[bucket] - actual);
        this.pending[bucket] -= actual;
      }
      this.resetSample();
    }
    drainDelta(minAbs = 0.2) {
      const absSum = SAVINGS_BUCKETS.reduce((s, k) => s + Math.abs(this.pending[k] || 0), 0);
      if (absSum < minAbs) return null;
      const out = { ...this.pending };
      this.pending = { skip: 0, speed: 0, silence: 0, reel: 0 };
      return out;
    }
  }
  class SilenceDetector {
    constructor({thresholdDb = -42, minSilenceMs = 320, releaseMs = 60, adaptive = true} = {}) {
      this.thresholdDb = thresholdDb;
      this.minSilenceMs = minSilenceMs;
      this.releaseMs = releaseMs;
      this.adaptive = adaptive !== false;
      this.resetAll();
    }
    static rmsToDb(samples) {
      if (!samples || !samples.length) return -Infinity;
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      return 20 * Math.log10(Math.max(Math.sqrt(sum / samples.length), 1e-7));
    }
    reset() {
      this.silentSince = null;
      this.loudSince = null;
      this.isSilent = false;
    }
    resetAll() {
      this.hasHeardAudio = false;
      this.speechPeakDb = null;
      this.noiseFloorDb = null;
      this.reset();
    }
    effectiveThreshold() {
      if (!this.adaptive || this.speechPeakDb === null || this.noiseFloorDb === null) return this.thresholdDb;
      if (this.speechPeakDb > -32 && this.speechPeakDb - this.noiseFloorDb >= 12) {
        return Math.max(this.thresholdDb, Math.min(-26, Math.min(this.speechPeakDb - 11, this.noiseFloorDb + 5)));
      }
      return this.thresholdDb;
    }
    update({db, now, active}) {
      if (!active || !Number.isFinite(db) || !Number.isFinite(now)) {
        this.reset();
        return false;
      }
      const clampedDb = Math.max(-65, Math.min(0, db));
      if (db > this.thresholdDb + 6) {
        this.hasHeardAudio = true;
        if (this.speechPeakDb === null) this.speechPeakDb = clampedDb;
        else if (clampedDb > this.speechPeakDb) this.speechPeakDb += (clampedDb - this.speechPeakDb) * 0.25;
        else this.speechPeakDb = Math.max(this.thresholdDb + 8, this.speechPeakDb - 0.02);
      }
      if (!this.hasHeardAudio) return false;
      if (db > -80 && this.speechPeakDb !== null) {
        if (this.noiseFloorDb === null) {
          if (clampedDb < this.speechPeakDb - 8) this.noiseFloorDb = clampedDb;
        } else if (clampedDb < this.noiseFloorDb) {
          this.noiseFloorDb += (clampedDb - this.noiseFloorDb) * 0.35;
        } else if (clampedDb < this.speechPeakDb - 8) {
          this.noiseFloorDb += (clampedDb - this.noiseFloorDb) * 0.04;
        }
      }
      const thresh = this.effectiveThreshold();
      if (db <= thresh) {
        this.loudSince = null;
        if (this.silentSince === null) this.silentSince = now;
        if (now - this.silentSince >= this.minSilenceMs) this.isSilent = true;
      } else if (db > thresh + 4) {
        this.silentSince = null;
        if (db > thresh + 6) {
          this.loudSince = null;
          this.isSilent = false;
        } else {
          if (this.loudSince === null) this.loudSince = now;
          if (now - this.loudSince >= this.releaseMs) this.isSilent = false;
        }
      }
      return this.isSilent;
    }
  }
  const PROMO_LINE_RE = /\b(sponsor(ed)? by|brought to you by|thanks to .{1,35} for sponsoring|use (my )?(promo |discount )?code|link(s)? in (the )?description|don'?t forget to (like|subscribe)|hit (that|the) (like|subscribe|bell)|smash (that|the) like|patreon\.com|check out my (store|shop|merch|course))\b/i;
  const FLUFF_LINE_RE = /\b(welcome back to (the|my) channel|hey (guys|everyone)|what'?s up (guys|everyone)|thanks (so much )?for watching|see you in the next (one|video)|let me know in the comments)\b/i;
  const STRONG_VERDICT_RE = /\b(in short|the bottom line|bottom line|tl;?dr|overall|the verdict|my verdict|in summary|to sum up|final thoughts|main takeaway|key takeaway|in conclusion|for most people|in my opinion|i('d| would) recommend|my recommendation)\b/i;
  const VERDICT_CUE_RE = /\b(in short|bottom line|tl;?dr|overall|the verdict|my verdict|in summary|to sum up|final thoughts|main takeaway|key takeaway|most important|the winner|in my opinion|for most people|i('d| would) recommend|worth buying|worth it|conclusion)\b/i;
  const EVIDENCE_CUE_RE = /\b(\d+(\.\d+)?\s*(%|x|fps|ms|gb|tb|mb|hz|w|wh|mah|hours?|mins?|minutes?|seconds?|days?|weeks?|months?|years?)|\$\d+|faster|slower|better|worse|cheaper|compared to|biggest (issue|problem|advantage|difference))\b/i;
  const DANGLING_END_RE = /(?:[,;:\-–—]|\b(?:of|to|in|for|with|on|at|from|by|about|into|onto|than|as|and|or|but|so|because|if|when|while|though|although|that|which|who|whom|whose|the|a|an|my|your|his|her|its|our|their|this|these|those|is|are|was|were|be|been|being|am|have|has|had|do|does|did|will|would|can|could|should|may|might|must|very|really|just|quite|too))\s*[.!]?$/i;
  const DANGLING_START_RE = /^(?:than|whereas|nor|or|of|from|into|onto|upon|except|besides)\b|^[a-z]+,\s+(?:and|or|but)\b/i;
  const HAS_PREDICATE_RE = /\b(is|isn't|are|aren't|was|wasn't|were|weren't|has|hasn't|have|haven't|had|can|can't|cannot|will|won't|would|wouldn't|should|shouldn't|could|couldn't|makes?|made|gives?|gave|gets?|got|takes?|took|costs?|lasts?|runs?|works?|feels?|looks?|sounds?|beats?|wins?|loses?|drops?|dropped|cuts?|saves?|saved|improves?|improved|changes?|changed|means?|needs?|keeps?|stays?|comes?|offers?|delivers?|brings?|supports?|includes?|lacks?|misses?|recommend|worth)\b/i;

  function cleanDigestText(text) {
    let cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    for (let i = 0; i < 2; i++) {
      const next = cleaned.replace(/^(?:(?:um+|uh+|well|and|but|so|honestly|basically),?\s+|like,\s+)/i, '').trim();
      if (next === cleaned) break;
      cleaned = next;
    }
    if (!cleaned) return '';
    return cleaned[0].toUpperCase() + cleaned.slice(1);
  }

  function isCompleteThought(rawText, hasPunctuation) {
    const text = cleanDigestText(rawText);
    if (text.length < 32 || text.length > 245) return false;
    if (/^\[.*\]$/.test(text) || PROMO_LINE_RE.test(text) || FLUFF_LINE_RE.test(text)) return false;
    if (text.includes('?')) return false;
    const words = text.split(/\s+/);
    if (words.length < 6) return false;
    if (hasPunctuation && !/[.!]["'”’)]?$/.test(text)) return false;
    if (DANGLING_END_RE.test(text) || DANGLING_START_RE.test(text)) return false;
    if (/^because\b/i.test(text) && !/^because\b[^,]{6,},\s+\S+(?:\s+\S+){3,}/i.test(text)) return false;
    if (/^(?:who|what|when|where|why|how)\b/i.test(text) && !/^what\s+\S+\s+(?:means|is|does)\b/i.test(text)) return false;
    if (!HAS_PREDICATE_RE.test(text)) return false;
    return true;
  }

  function buildSentenceUnits(lines) {
    const cleanLines = lines
      .map(l => ({ ...l, text: l.text.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim() }))
      .filter(l => l.text.length > 0);
    if (!cleanLines.length) return { units: [], hasPunctuation: false };
    const punctCount = cleanLines.filter(l => /[.!?]["'”’)]?$/.test(l.text) || /[.!?]["'”’)]?\s+\S/.test(l.text)).length;
    const hasPunctuation = punctCount >= Math.max(3, Math.floor(cleanLines.length * 0.3));

    if (!hasPunctuation) {
      const units = [];
      let cur = null;
      for (const l of cleanLines) {
        const gap = cur ? l.start - cur.end : 0;
        const startsClause = /^(?:so overall|overall|bottom line|in conclusion|in summary|first|second|third|next|finally)\b/i.test(l.text);
        if (cur && (gap > 0.9 || startsClause || cur.text.length + 1 + l.text.length > 150)) {
          units.push(cur);
          cur = null;
        }
        if (!cur) cur = { start: l.start, end: l.end, text: l.text };
        else {
          cur.text += ' ' + l.text;
          cur.end = Math.max(cur.end, l.end);
        }
      }
      if (cur) units.push(cur);
      return { units, hasPunctuation: false };
    }

    // Split cues at internal sentence boundaries (. ! ?) while interpolating timestamps,
    // then stitch consecutive cues together until a grammatical sentence ends.
    const pieces = [];
    for (const l of cleanLines) {
      const dur = Math.max(0.2, l.end - l.start);
      const totalChars = Math.max(1, l.text.length);
      let cursor = 0;
      const parts = [];
      const re = /([.!?]["'”’)]?)\s+/g;
      let lastIdx = 0, m;
      while ((m = re.exec(l.text))) {
        const endIdx = m.index + m[1].length;
        const before = l.text.slice(lastIdx, endIdx).trim();
        if (/\b(?:mr|mrs|ms|dr|vs|etc|e\.g|i\.e)\.$/i.test(before)) continue;
        if (before) parts.push(before);
        lastIdx = re.lastIndex;
      }
      const tail = l.text.slice(lastIdx).trim();
      if (tail) parts.push(tail);
      for (const p of parts) {
        const pStart = l.start + (cursor / totalChars) * dur;
        cursor += p.length + 1;
        const pEnd = l.start + Math.min(1, cursor / totalChars) * dur;
        pieces.push({ start: pStart, end: Math.max(pStart + 0.1, pEnd), text: p });
      }
    }

    const units = [];
    let cur = null;
    for (const p of pieces) {
      if (cur && p.start - cur.end > 2.8) {
        units.push(cur);
        cur = null;
      }
      if (!cur) cur = { start: p.start, end: p.end, text: p.text };
      else {
        cur.text += ' ' + p.text;
        cur.end = Math.max(cur.end, p.end);
      }
      if (/[.!?]["'”’)]?$/.test(p.text) || cur.text.length >= 220) {
        units.push(cur);
        cur = null;
      }
    }
    if (cur) units.push(cur);
    return { units, hasPunctuation: true };
  }

  function contentTokens(text) {
    return (String(text || '').toLowerCase().match(/[a-z0-9]{4,}/g) || [])
      .filter(w => !/^(this|that|with|from|have|your|they|what|when|where|which|there|their|about|would|could|should|these|those|really|actually|going|video)$/.test(w));
  }

  function tokenOverlapRatio(aTokens, bTokens) {
    if (!aTokens.length || !bTokens.length) return 0;
    const setB = new Set(bTokens);
    let shared = 0;
    for (const t of aTokens) if (setB.has(t)) shared++;
    return shared / Math.min(aTokens.length, bTokens.length);
  }

  function tldrReelBudget(duration = 0, depth = 'balanced') {
    const mode = depth === 'skim' || depth === 'deep' ? depth : 'balanced';
    const dur = Number.isFinite(+duration) && +duration > 0 ? +duration : 600;
    const mins = Math.max(1, dur / 60);
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    if (mode === 'skim') {
      return {
        depth: 'skim',
        targetSec: clamp(Math.round(dur * 0.048), 30, 360),
        maxClips: clamp(3 + Math.floor(mins / 12), 4, 10),
        minClipSec: clamp(10 + Math.round(mins * 0.1), 10, 16),
        maxClipSec: clamp(16 + Math.round(mins * 0.35), 18, 36),
        leadInUnits: 0,
        leadInMaxSec: 3,
        minSpacing: clamp(Math.round(dur * 0.055), 12, 150),
        mergeGapSec: dur >= 900 ? 4 : 2,
        maxTakeaways: clamp(4 + Math.floor(mins / 25), 4, 6),
      };
    }
    if (mode === 'deep') {
      return {
        depth: 'deep',
        targetSec: clamp(Math.round(dur * 0.22), 75, 1600),
        maxClips: clamp(7 + Math.floor(mins / 4), 7, 26),
        minClipSec: clamp(16 + Math.round(mins * 0.35), 16, 38),
        maxClipSec: clamp(36 + Math.round(mins * 0.75), 38, 92),
        leadInUnits: 2,
        leadInMaxSec: 16,
        minSpacing: clamp(Math.round(dur * 0.025), 10, 90),
        mergeGapSec: dur >= 900 ? 9 : 4,
        maxTakeaways: clamp(6 + Math.floor(mins / 10), 6, 12),
      };
    }
    return {
      depth: 'balanced',
      targetSec: clamp(Math.round(dur * 0.12), 45, 900),
      maxClips: clamp(5 + Math.floor(mins / 6), 5, 18),
      minClipSec: clamp(12 + Math.round(mins * 0.25), 12, 28),
      maxClipSec: clamp(24 + Math.round(mins * 0.55), 26, 65),
      leadInUnits: 1,
      leadInMaxSec: 10,
      minSpacing: clamp(Math.round(dur * 0.035), 12, 120),
      mergeGapSec: dur >= 900 ? 7 : 3,
      maxTakeaways: clamp(5 + Math.floor(mins / 15), 5, 10),
    };
  }

  function buildTldrDigest({ duration = 0, chapters = [], heatmap = [], transcript = [], cutPlan = null, poiHighlights = [], depth = 'balanced' } = {}) {
    const cleanDepth = depth === 'skim' || depth === 'deep' ? depth : 'balanced';
    const rawSegs = Array.isArray(cutPlan?.rawSegments) ? cutPlan.rawSegments
      : Array.isArray(cutPlan?.segments) ? cutPlan.segments : [];
    const cleanChaps = (Array.isArray(chapters) ? chapters : [])
      .filter(c => c && Number.isFinite(+c.start) && +c.start >= 0 && typeof c.title === 'string' && c.title.trim())
      .map(c => ({ start: +c.start, title: c.title.trim() }))
      .sort((a, b) => a.start - b.start);

    const seenLine = new Set();
    const sortedRawLines = (Array.isArray(transcript) ? transcript : [])
      .filter(t => t && Number.isFinite(+t.start) && +t.start >= 0 && typeof t.text === 'string' && t.text.trim())
      .sort((a, b) => +a.start - +b.start)
      .filter(t => {
        const k = `${+t.start}|${t.text.trim()}`;
        if (seenLine.has(k)) return false;
        seenLine.add(k);
        return true;
      });
    const lines = sortedRawLines.map((t, i) => {
      const start = +t.start;
      const explicitEnd = Number.isFinite(+t.end) && +t.end > start ? +t.end
        : (Number.isFinite(+t.duration) && +t.duration > 0 ? start + +t.duration : 0);
      const nextStart = i + 1 < sortedRawLines.length ? +sortedRawLines[i + 1].start : start + 5;
      const end = explicitEnd > start ? explicitEnd : Math.max(start + 1, Math.min(nextStart, start + 7));
      return { start, end, text: t.text.replace(/\s+/g, ' ').trim() };
    });

    const rawPoiTimes = (Array.isArray(poiHighlights) ? poiHighlights : [])
      .map(p => Number.isFinite(+p) ? +p : +p?.start)
      .filter(t => Number.isFinite(t) && t >= 0);

    const dur = Number.isFinite(+duration) && +duration > 0 ? +duration
      : Math.max(
          lines.length ? lines[lines.length - 1].end : 0,
          Array.isArray(heatmap) && heatmap.length ? Math.max(...heatmap.map(h => +h.end || 0)) : 0,
          rawSegs.length ? Math.max(...rawSegs.map(s => +s.end || 0)) : 0,
          rawPoiTimes.length ? Math.max(...rawPoiTimes) + 12 : 0
        );
    const budget = tldrReelBudget(dur, cleanDepth);

    const excluded = rawSegs.filter(s => s && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start &&
      (s.sponsor || sponsorPattern.test(s.reason || '') ||
       (s.action === 'skip' && !/^(non-highlight|low replays)$/i.test(String(s.reason || '').trim()))));
    const isExcluded = (start, end) => {
      const len = Math.max(0.1, end - start);
      let bad = 0;
      for (const ex of excluded) {
        const ov = Math.max(0, Math.min(end, ex.end) - Math.max(start, ex.start));
        if (ov > 0) bad += ov;
      }
      return bad / len >= 0.35;
    };
    const hasExcludedBetween = (start, end) => excluded.some(ex => ex.end > start + 0.05 && ex.start < end - 0.05);

    const cleanPois = rawPoiTimes
      .filter(t => (!dur || t <= dur) && !isExcluded(Math.max(0, t - 1), t + 2))
      .sort((a, b) => a - b)
      .filter((t, i, arr) => i === 0 || t - arr[i - 1] >= 4);

    const cleanHeat = (Array.isArray(heatmap) ? heatmap : [])
      .filter(h => h && Number.isFinite(+h.start) && Number.isFinite(+h.end) && +h.end > +h.start)
      .map(h => ({ start: +h.start, end: +h.end, score: Number.isFinite(+h.score) ? +h.score : 0 }))
      .sort((a, b) => a.start - b.start);

    const topPeakCount = Math.max(5, Math.min(14, budget.maxClips));
    const topPeakTimes = [
      ...cleanPois,
      ...[...cleanHeat]
        .filter(h => !isExcluded(h.start, h.end))
        .sort((a, b) => b.score - a.score)
        .slice(0, topPeakCount)
        .map(h => (h.start + h.end) / 2),
    ];

    const { units: sentenceUnits, hasPunctuation } = buildSentenceUnits(lines);

    const scoreUnit = (unit) => {
      const txt = unit.text;
      if (isExcluded(unit.start, unit.end)) return -10;
      if (!isCompleteThought(txt, hasPunctuation)) return -10;
      let score = 1;
      if (STRONG_VERDICT_RE.test(txt)) score += 4.5;
      else if (VERDICT_CUE_RE.test(txt)) score += 2.2;
      if (EVIDENCE_CUE_RE.test(txt)) score += 2.5;
      if (/[.!]["'”’)]?$/.test(txt)) score += 1.2;
      if (topPeakTimes.some(pt => Math.abs((unit.start + unit.end) / 2 - pt) <= Math.max(10, dur * 0.012))) score += 2.2;
      if (dur > 30 && unit.start >= dur * 0.6 && unit.start <= dur * 0.96) score += 1.2;
      if (cleanChaps.some(c => unit.start >= c.start && unit.start <= c.start + 18)) score += 0.8;
      if (txt.length >= 45 && txt.length <= 185) score += 0.8;
      return score;
    };

    const scoredUnits = sentenceUnits.map(u => ({ ...u, score: scoreUnit(u), tokens: contentTokens(u.text) }));
    const goodUnits = scoredUnits.filter(u => u.score > 0);
    const lineTokens = lines
      .filter(l => !isExcluded(l.start, l.end) && !PROMO_LINE_RE.test(l.text) && !FLUFF_LINE_RE.test(l.text))
      .map(l => ({ ...l, tokens: contentTokens(l.text) }));

    const topicAt = (sec) => {
      if (!cleanChaps.length) return '';
      const found = [...cleanChaps].filter(c => c.start <= sec + 2).pop();
      return found ? found.title : '';
    };
    const previewAt = (start, end) => {
      const insideUnits = goodUnits.filter(u => u.end > start + 0.5 && u.start < end - 0.5);
      if (insideUnits.length) {
        const best = [...insideUnits].sort((a, b) => b.score - a.score)[0];
        const text = cleanDigestText(best.text);
        return text.length > 96 ? text.slice(0, 95).trimEnd() + '…' : text;
      }
      const insideLines = lines.filter(l => l.end > start + 0.2 && l.start < end - 0.2 && !PROMO_LINE_RE.test(l.text) && !FLUFF_LINE_RE.test(l.text));
      if (!insideLines.length) return '';
      const joined = cleanDigestText(insideLines.slice(0, 3).map(l => l.text).join(' '));
      return joined.length > 96 ? joined.slice(0, 95).trimEnd() + '…' : joined;
    };
    const snapWindow = (rawStart, rawEnd) => {
      let s = Math.max(0, rawStart), e = dur > 0 ? Math.min(dur, rawEnd) : rawEnd;
      if (lines.length) {
        const startLine = lines.find(l => l.start <= s && l.end > s + 0.15 && s - l.start <= 2.2);
        if (startLine && !isExcluded(startLine.start, startLine.end)) s = startLine.start;
        const endLine = [...lines].reverse().find(l => l.start < e - 0.15 && l.end >= e && l.end - e <= 2.2);
        if (endLine && !isExcluded(endLine.start, endLine.end)) e = dur > 0 ? Math.min(dur, endLine.end) : endLine.end;
      }
      for (const ex of excluded) {
        if (ex.start <= s && ex.end > s && ex.end < e) s = ex.end;
        if (ex.start > s && ex.start < e && ex.end >= e) e = ex.start;
      }
      return { start: Math.round(s * 10) / 10, end: Math.round(e * 10) / 10 };
    };
    const expandClipContext = (rawStart, rawEnd, maxSpan = budget.maxClipSec) => {
      const base = snapWindow(rawStart, rawEnd);
      let s = base.start, e = base.end;
      if (sentenceUnits.length && e > s) {
        // Finish any overlapping concluding sentence cleanly so clips never chop mid-thought.
        const tailUnit = sentenceUnits.find(u => u.start < e - 0.2 && u.end > e && u.end - e <= 8 && !isExcluded(u.start, u.end) && !PROMO_LINE_RE.test(u.text));
        if (tailUnit && tailUnit.end - s <= maxSpan && !hasExcludedBetween(e, tailUnit.end)) {
          e = dur > 0 ? Math.min(dur, tailUnit.end) : tailUnit.end;
        }
        // Pull in 1-2 preceding setup sentences so punchlines/verdicts have conversational lead-in.
        if (budget.leadInUnits > 0) {
          let added = 0;
          for (let i = sentenceUnits.length - 1; i >= 0 && added < budget.leadInUnits; i--) {
            const u = sentenceUnits[i];
            if (u.end > s + 0.4) continue;
            const gap = s - u.end;
            if (gap > 3.2) break;
            if (base.start - u.start > budget.leadInMaxSec) break;
            if (e - u.start > maxSpan) break;
            if (isExcluded(u.start, u.end) || hasExcludedBetween(u.start, s)) break;
            if (PROMO_LINE_RE.test(u.text) || FLUFF_LINE_RE.test(u.text)) break;
            s = Math.max(0, u.start);
            added++;
          }
        }
      }
      return snapWindow(s, e);
    };

    const mergeCloseClips = (rawClips) => {
      const sorted = [...rawClips]
        .filter(c => c && Number.isFinite(c.start) && Number.isFinite(c.end) && c.end - c.start >= 3.5 && !isExcluded(c.start, c.end))
        .sort((a, b) => a.start - b.start);
      const merged = [];
      for (const c of sorted) {
        const prev = merged[merged.length - 1];
        if (
          prev &&
          c.start - prev.end <= budget.mergeGapSec &&
          !hasExcludedBetween(prev.end, c.start) &&
          Math.max(prev.end, c.end) - prev.start <= budget.maxClipSec * 1.4
        ) {
          prev.end = Math.round(Math.max(prev.end, c.end) * 10) / 10;
          if (prev.source !== c.source && !prev.source.includes(c.source)) prev.source = `${prev.source}+${c.source}`;
        } else {
          merged.push({ ...c, start: Math.round(c.start * 10) / 10, end: Math.round(c.end * 10) / 10 });
        }
      }
      return merged;
    };

    // 1) Build playable highlight clips.
    let highlights = [];
    let highlightSource = 'none';

    if (rawSegs.length && dur > 0) {
      const cuts = rawSegs
        .filter(s => s && (s.action === 'skip' || s.action === 'speed') && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
        .map(s => ({ start: Math.max(0, s.start), end: Math.min(dur, s.end) }))
        .sort((a, b) => a.start - b.start);
      const mergedCuts = [];
      for (const c of cuts) {
        const last = mergedCuts[mergedCuts.length - 1];
        if (last && c.start <= last.end + 1.5) last.end = Math.max(last.end, c.end);
        else mergedCuts.push({ ...c });
      }
      const keeps = [];
      let cursor = 0;
      for (const c of mergedCuts) {
        if (c.start - cursor >= 3) keeps.push({ start: cursor, end: c.start });
        cursor = Math.max(cursor, c.end);
      }
      if (dur - cursor >= 3) keeps.push({ start: cursor, end: dur });
      const keepTotal = keeps.reduce((acc, k) => acc + (k.end - k.start), 0);
      const maxKeepRatio = cleanDepth === 'deep' ? 0.72 : 0.58;
      if (keeps.length >= 1 && keepTotal > 0 && keepTotal <= dur * maxKeepRatio) {
        const refinedKeeps = [];
        for (const k of keeps) {
          const kLen = k.end - k.start;
          if (dur >= 900 && cleanDepth !== 'deep' && kLen > budget.maxClipSec * 1.85 && goodUnits.length) {
            const inside = goodUnits.filter(u => u.start >= k.start && u.end <= k.end).sort((a, b) => b.score - a.score);
            if (inside.length) {
              const anchor = inside[0];
              const subStart = Math.max(k.start, anchor.start);
              const subEnd = Math.min(k.end, Math.max(anchor.end, subStart + budget.minClipSec + 4));
              const focused = expandClipContext(subStart, subEnd, budget.maxClipSec * 1.25);
              if (focused.end - focused.start >= 4) {
                refinedKeeps.push(focused);
                continue;
              }
            }
          }
          refinedKeeps.push(k);
        }
        let selected = refinedKeeps.map(k => {
          const mid = (k.start + k.end) / 2;
          const lineBoost = goodUnits
            .filter(u => u.end > k.start && u.start < k.end)
            .reduce((mx, u) => Math.max(mx, u.score), 0);
          const peakBoost = topPeakTimes.some(pt => pt >= k.start - 3 && pt <= k.end + 3) ? 3 : 0;
          return { ...k, rank: lineBoost + peakBoost + (mid > dur * 0.6 ? 0.5 : 0) };
        });
        if (selected.length > budget.maxClips) {
          selected = [...selected].sort((a, b) => b.rank - a.rank).slice(0, budget.maxClips).sort((a, b) => a.start - b.start);
        }
        highlights = selected.map((k, idx) => ({
          start: Math.round(k.start * 10) / 10,
          end: Math.round(k.end * 10) / 10,
          label: topicAt(k.start) || `Highlight ${idx + 1}`,
          preview: previewAt(k.start, k.end),
          source: cutPlan?.aiModel ? 'ai' : 'plan',
        }));
        highlightSource = cutPlan?.aiModel ? 'ai' : 'plan';
      }
    }

    if (!highlights.length) {
      const picked = [];
      const pickedDuration = () => picked.reduce((acc, p) => acc + Math.max(0, p.end - p.start), 0);
      const overlapsPicked = (s, e, pad = 3) => picked.some(p => s < p.end + pad && e > p.start - pad);

      // Pass A: Community POI highlights + Most Replayed heatmap peaks (bucket-width aware for long videos).
      if (cleanPois.length || cleanHeat.length >= 4) {
        const poiLimit = Math.max(3, Math.min(6, Math.ceil(budget.maxClips * 0.4)));
        for (const pt of cleanPois.slice(0, poiLimit)) {
          const s = Math.max(0, pt - 2);
          const e = dur > 0 ? Math.min(dur, s + Math.max(13, budget.minClipSec)) : s + 13;
          const snapped = expandClipContext(s, e, budget.maxClipSec);
          if (snapped.end - snapped.start >= 4 && !isExcluded(snapped.start, snapped.end) && !overlapsPicked(snapped.start, snapped.end)) {
            picked.push({ ...snapped, source: 'poi' });
          }
        }
        if (cleanHeat.length >= 4) {
          const avgBucketSpan = cleanHeat.reduce((a, h) => a + (h.end - h.start), 0) / cleanHeat.length;
          const maxPeakSpan = Math.max(budget.maxClipSec, Math.min(95, Math.round(avgBucketSpan * 1.65)));
          const scores = cleanHeat.map(h => h.score).sort((a, b) => a - b);
          const median = scores[scores.length >> 1] || 0;
          const maxScore = scores[scores.length - 1] || 0;
          if (maxScore - median >= 0.05) {
            const candidates = cleanHeat
              .map((h, i) => ({ ...h, i }))
              .filter(h => !isExcluded(h.start, h.end) && h.score > median + 0.04)
              .sort((a, b) => b.score - a.score);
            for (const cand of candidates) {
              if (picked.length >= budget.maxClips || pickedDuration() >= budget.targetSec * 1.15) break;
              const mid = (cand.start + cand.end) / 2;
              if (picked.some(p => Math.abs((p.start + p.end) / 2 - mid) < budget.minSpacing) || overlapsPicked(cand.start, cand.end)) {
                continue;
              }
              let lo = cand.i, hi = cand.i;
              const floor = Math.max(median, cand.score * (cleanDepth === 'deep' ? 0.55 : 0.65));
              while (lo > 0 && cleanHeat[lo - 1].score >= floor && cand.end - cleanHeat[lo - 1].start <= maxPeakSpan && !isExcluded(cleanHeat[lo - 1].start, cleanHeat[lo - 1].end)) lo--;
              while (hi + 1 < cleanHeat.length && cleanHeat[hi + 1].score >= floor && cleanHeat[hi + 1].end - cleanHeat[lo].start <= maxPeakSpan && !isExcluded(cleanHeat[hi + 1].start, cleanHeat[hi + 1].end)) hi++;
              let s = cleanHeat[lo].start, e = cleanHeat[hi].end;
              if (e - s > budget.maxClipSec) {
                const peakMid = (cand.start + cand.end) / 2;
                s = Math.max(s, peakMid - budget.maxClipSec * 0.45);
                e = Math.min(e, s + budget.maxClipSec);
              } else if (e - s < budget.minClipSec) {
                const pad = (budget.minClipSec - (e - s)) / 2;
                s = Math.max(0, s - pad);
                e = dur > 0 ? Math.min(dur, e + pad) : e + pad;
              }
              const snapped = expandClipContext(s, e, budget.maxClipSec);
              if (snapped.end - snapped.start >= 4 && !isExcluded(snapped.start, snapped.end) && !overlapsPicked(snapped.start, snapped.end)) {
                picked.push({ ...snapped, source: 'heatmap' });
              }
            }
          }
        }
      }

      // Pass B: On longer videos (>= 12 min), guarantee chapter / timeline-zone coverage so later sections are never starved.
      const isLongVideo = dur >= 720;
      if (isLongVideo && picked.length < budget.maxClips && pickedDuration() < budget.targetSec * 0.92 && (goodUnits.length || cleanHeat.length >= 4)) {
        const zones = cleanChaps.length >= 3
          ? cleanChaps.map((c, idx) => ({
              start: c.start,
              end: idx + 1 < cleanChaps.length ? cleanChaps[idx + 1].start : dur,
              title: c.title,
            })).filter(z => z.end - z.start >= 75 && !/^(intro|introduction|welcome|sponsor|outro|credits)$/i.test(z.title.trim()))
          : (() => {
              const count = Math.min(10, Math.max(4, Math.floor(dur / 480)));
              const span = dur / count;
              return Array.from({ length: count }, (_, i) => ({ start: i * span, end: (i + 1) * span, title: '' }));
            })();

        for (const z of zones) {
          if (picked.length >= budget.maxClips || pickedDuration() >= budget.targetSec * 1.05) break;
          if (picked.some(p => p.end > z.start + 5 && p.start < z.end - 5)) continue;
          const zoneUnits = goodUnits.filter(u => u.start >= z.start && u.end <= z.end + 4);
          if (zoneUnits.length) {
            const bestUnit = zoneUnits
              .map(u => {
                const heatHere = cleanHeat.find(h => (u.start + u.end) / 2 >= h.start && (u.start + u.end) / 2 <= h.end);
                const winEnd = Math.min(z.end, Math.max(u.end, u.start + budget.minClipSec));
                const clusterScore = zoneUnits
                  .filter(x => x.start >= u.start && x.start < winEnd)
                  .reduce((acc, x) => acc + x.score, 0);
                return { u, winEnd, rank: clusterScore + (heatHere ? heatHere.score * 3 : 0) };
              })
              .sort((a, b) => b.rank - a.rank)[0];
            const snapped = expandClipContext(bestUnit.u.start, bestUnit.winEnd, budget.maxClipSec);
            if (snapped.end - snapped.start >= 4 && !isExcluded(snapped.start, snapped.end) && !overlapsPicked(snapped.start, snapped.end, 5)) {
              picked.push({ ...snapped, source: 'captions' });
              continue;
            }
          }
          const zoneHeat = cleanHeat
            .filter(h => h.start >= z.start && h.end <= z.end + 5 && !isExcluded(h.start, h.end))
            .sort((a, b) => b.score - a.score)[0];
          if (zoneHeat) {
            const mid = (zoneHeat.start + zoneHeat.end) / 2;
            const half = Math.min(budget.maxClipSec, Math.max(budget.minClipSec, 18)) / 2;
            const snapped = expandClipContext(Math.max(z.start, mid - half), Math.min(z.end, mid + half), budget.maxClipSec);
            if (snapped.end - snapped.start >= 4 && !isExcluded(snapped.start, snapped.end) && !overlapsPicked(snapped.start, snapped.end, 5)) {
              picked.push({ ...snapped, source: 'heatmap' });
            }
          }
        }
      }

      // Pass C: High-signal caption digest (primary when no heatmap, or top-up on long/deep videos when below target budget).
      const needCaptionFill = !picked.length || ((isLongVideo || cleanDepth === 'deep') && pickedDuration() < budget.targetSec * 0.78 && picked.length < budget.maxClips);
      if (needCaptionFill && goodUnits.length) {
        const winLen = dur > 0 ? Math.max(budget.minClipSec, Math.min(budget.maxClipSec, Math.round(dur * (isLongVideo ? 0.025 : 0.08)))) : 16;
        const minGap = Math.max(10, budget.minSpacing * 0.65);
        const candidates = goodUnits.map(u => {
          const s = u.start;
          const e = dur > 0 ? Math.min(dur, Math.max(u.end, s + winLen)) : Math.max(u.end, s + winLen);
          const sumScore = goodUnits
            .filter(x => x.start >= s && x.start < e)
            .reduce((acc, x) => acc + x.score, 0);
          return { start: s, end: e, score: sumScore };
        }).sort((a, b) => b.score - a.score);
        for (const c of candidates) {
          if (picked.length >= budget.maxClips || (picked.length >= 2 && pickedDuration() >= budget.targetSec)) break;
          const snapped = expandClipContext(c.start, c.end, budget.maxClipSec);
          if (snapped.end - snapped.start < 4 || isExcluded(snapped.start, snapped.end)) continue;
          if (overlapsPicked(snapped.start, snapped.end, minGap * 0.45)) continue;
          picked.push({ ...snapped, source: 'captions' });
        }
      }

      // Pass D: Chapters-only fallback when neither heatmap nor captions exist.
      if (!picked.length && cleanChaps.length && dur > 0) {
        const step = Math.max(1, Math.ceil(cleanChaps.length / budget.maxClips));
        for (let i = 0; i < cleanChaps.length && picked.length < budget.maxClips; i += step) {
          const c = cleanChaps[i];
          const nextStart = cleanChaps[i + 1]?.start ?? dur;
          const e = Math.min(dur, nextStart, c.start + Math.max(18, budget.minClipSec + 6));
          if (e - c.start >= 4 && !isExcluded(c.start, e)) {
            picked.push({ start: Math.round(c.start * 10) / 10, end: Math.round(e * 10) / 10, source: 'chapters', chapterTitle: c.title });
          }
        }
      }

      const coalesced = mergeCloseClips(picked);
      if (coalesced.length) {
        const usedPoi = coalesced.some(p => p.source.includes('poi'));
        const usedHeat = coalesced.some(p => p.source.includes('heatmap'));
        const usedCaps = coalesced.some(p => p.source.includes('captions'));
        const usedChaps = coalesced.some(p => p.source.includes('chapters'));
        highlights = coalesced.map((p, idx) => ({
          start: p.start,
          end: p.end,
          label: p.chapterTitle || topicAt(p.start) || (p.source === 'poi' ? 'Community highlight' : p.source.includes('heatmap') ? `Peak ${idx + 1}` : `Key point ${idx + 1}`),
          preview: previewAt(p.start, p.end),
          source: p.source,
        }));
        highlightSource = usedPoi && usedHeat ? 'poi+heatmap'
          : usedPoi ? (lines.length ? 'poi+captions' : 'poi')
          : usedHeat ? (lines.length || usedCaps ? 'heatmap+captions' : 'heatmap')
          : usedCaps ? 'captions'
          : usedChaps ? 'chapters' : 'none';
      }
    }

    // 2) Build bottom-line summary (single coherent conclusion/overview — never glue chopped fragments).
    let summary = '';
    let verdictUnit = null;
    const aiSummary = typeof cutPlan?.summary === 'string' ? cutPlan.summary.replace(/^Verified section notes:\s*/i, '').trim() : '';
    if (aiSummary) {
      summary = aiSummary;
    } else if (goodUnits.length) {
      verdictUnit = [...goodUnits].sort((a, b) => {
        const va = a.score + (STRONG_VERDICT_RE.test(a.text) ? 3.5 : VERDICT_CUE_RE.test(a.text) ? 1.5 : 0) + (dur > 30 && a.start >= dur * 0.55 ? 1.2 : 0);
        const vb = b.score + (STRONG_VERDICT_RE.test(b.text) ? 3.5 : VERDICT_CUE_RE.test(b.text) ? 1.5 : 0) + (dur > 30 && b.start >= dur * 0.55 ? 1.2 : 0);
        return vb - va;
      })[0];
      const verdictText = cleanDigestText(verdictUnit.text);
      if (STRONG_VERDICT_RE.test(verdictUnit.text)) {
        summary = verdictText;
      } else if (cleanChaps.length >= 2) {
        summary = 'Covers ' + cleanChaps.slice(0, 5).map(c => c.title).join(', ') + '. ' + verdictText;
      } else {
        summary = verdictText;
      }
      if (summary.length > 320) summary = summary.slice(0, 319).trimEnd() + '…';
    } else if (cleanChaps.length) {
      summary = 'Topics covered: ' + cleanChaps.slice(0, 6).map(c => c.title).join(' · ');
    } else if (highlights.length) {
      summary = 'Jump straight to the most-replayed highlights below, or play the highlight reel.';
    } else {
      summary = 'No captions or replay graph available yet for this video.';
    }

    // 3) Build takeaways with timestamps (excluding the verdict sentence when other distinct takeaways exist).
    let takeaways = [];
    const aiTakeaways = Array.isArray(cutPlan?.takeaways) ? cutPlan.takeaways.filter(t => typeof t === 'string' && t.trim()) : [];
    if (aiTakeaways.length) {
      takeaways = aiTakeaways.slice(0, 6).map(raw => {
        const text = raw.trim();
        const toks = contentTokens(text);
        let bestLine = null, bestOverlap = 0;
        if (toks.length >= 2 && lineTokens.length) {
          for (const l of lineTokens) {
            const ov = tokenOverlapRatio(toks, l.tokens);
            if (ov > bestOverlap && ov >= 0.34) {
              bestOverlap = ov;
              bestLine = l;
            }
          }
        }
        return { text, start: bestLine ? Math.round(bestLine.start * 10) / 10 : null };
      });
    } else if (goodUnits.length) {
      const pool = goodUnits.length >= 3 && verdictUnit ? goodUnits.filter(u => u !== verdictUnit) : goodUnits;
      const ranked = [...pool].sort((a, b) => b.score - a.score);
      const chosen = [];
      const minLineSpacing = dur > 0 ? Math.min(18, Math.max(6, dur * 0.05)) : 12;
      for (const u of ranked) {
        if (chosen.length >= budget.maxTakeaways) break;
        if (chosen.some(c => Math.abs(c.start - u.start) < minLineSpacing || tokenOverlapRatio(c.tokens, u.tokens) >= 0.55)) continue;
        chosen.push(u);
      }
      chosen.sort((a, b) => a.start - b.start);
      takeaways = chosen.map(c => ({ text: cleanDigestText(c.text), start: Math.round(c.start * 10) / 10 }));
    } else if (cleanChaps.length) {
      takeaways = cleanChaps.slice(0, budget.maxTakeaways).map(c => ({ text: c.title, start: Math.round(c.start * 10) / 10 }));
    }

    const reelDuration = Math.round(highlights.reduce((acc, h) => acc + Math.max(0, h.end - h.start), 0));
    const totalDuration = Math.round(dur);
    const savedSeconds = totalDuration > 0 && reelDuration > 0 ? Math.max(0, totalDuration - reelDuration) : 0;
    const savedPercent = totalDuration > 0 && reelDuration > 0
      ? Math.max(0, Math.min(99, Math.round((1 - reelDuration / totalDuration) * 100)))
      : 0;
    const sourceLabel = cutPlan?.aiModel || aiSummary || aiTakeaways.length
      ? 'AI + Captions'
      : highlightSource === 'poi+heatmap' ? 'Community highlight + Most Replayed'
      : highlightSource === 'poi+captions' ? 'Community highlight + Captions'
      : highlightSource === 'poi' ? 'Community highlight'
      : highlightSource === 'heatmap+captions' ? 'Most Replayed + Captions'
      : highlightSource === 'heatmap' ? 'Most Replayed peaks'
      : highlightSource === 'captions' || goodUnits.length ? 'Transcript digest'
      : highlightSource === 'chapters' || cleanChaps.length ? 'Video chapters'
      : 'Overview';

    return {
      summary,
      takeaways,
      highlights,
      depth: cleanDepth,
      targetDuration: budget.targetSec,
      totalDuration,
      reelDuration,
      duration: totalDuration,
      reelSeconds: reelDuration,
      savedSeconds,
      savedPercent,
      sourceLabel,
      aiPowered: !!(cutPlan?.aiModel || aiSummary || aiTakeaways.length),
    };
  }

  function formatTldrMarkdown({ title = '', videoId = '', digest }) {
    if (!digest) return '';
    const esc = s => String(s || '').replace(/([\\`*_{}[\]<>#!|])/g, '\\$1').replace(/\r?\n/g, ' ');
    const safeId = typeof videoId === 'string' && /^[\w-]{6,20}$/.test(videoId) ? videoId : '';
    const baseUrl = safeId ? `https://www.youtube.com/watch?v=${encodeURIComponent(safeId)}` : '';
    const out = [`# TL;DR: ${esc(title || safeId || 'YouTube Video')}`];
    if (baseUrl) out.push('', baseUrl);
    if (digest.reelDuration > 0 && digest.totalDuration > 0) {
      out.push('', `_${esc(digest.sourceLabel)} · ${fmtStamp(digest.totalDuration)} → ${fmtStamp(digest.reelDuration)} highlight reel (−${digest.savedPercent}%)_`);
    }
    if (digest.summary) out.push('', digest.summary);
    if (Array.isArray(digest.takeaways) && digest.takeaways.length) {
      out.push('', '## Key takeaways', '');
      for (const t of digest.takeaways) {
        const prefix = Number.isFinite(t.start) && baseUrl
          ? `[${fmtStamp(t.start)}](${baseUrl}&t=${Math.floor(t.start)}s) `
          : Number.isFinite(t.start) ? `${fmtStamp(t.start)} ` : '';
        out.push(`- ${prefix}${esc(t.text)}`);
      }
    }
    if (Array.isArray(digest.highlights) && digest.highlights.length) {
      out.push('', '## Highlight clips', '');
      for (const h of digest.highlights) {
        const range = `${fmtStamp(h.start)}–${fmtStamp(h.end)}`;
        const link = baseUrl ? `[${range}](${baseUrl}&t=${Math.floor(h.start)}s)` : range;
        out.push(`- ${link} **${esc(h.label)}**${h.preview ? ` — ${esc(h.preview)}` : ''}`);
      }
    }
    return out.join('\n') + '\n';
  }

  function computeRemainingWatchTime({ currentTime = 0, duration = 0, baseRate = 1, speedRate = 3, segments = [], nowMs = Date.now() } = {}) {
    const now = Number.isFinite(+nowMs) ? +nowMs : Date.now();
    const dur = Number(duration);
    if (!Number.isFinite(dur) || dur <= 0) {
      return { rawRemainingSec: 0, realRemainingSec: 0, cutsAheadSec: 0, finishAtMs: now };
    }
    const cur = Math.max(0, Math.min(dur, Number.isFinite(+currentTime) ? +currentTime : 0));
    const rawRemainingSec = Math.max(0, dur - cur);
    if (rawRemainingSec <= 0.01) {
      return { rawRemainingSec: 0, realRemainingSec: 0, cutsAheadSec: 0, finishAtMs: now };
    }
    const normalRate = Math.max(0.25, Math.min(4, Number.isFinite(+baseRate) && +baseRate > 0 ? +baseRate : 1));
    const configuredSpeed = Math.max(1.25, Math.min(4, Number.isFinite(+speedRate) && +speedRate > 0 ? +speedRate : 3));
    const clamped = (Array.isArray(segments) ? segments : [])
      .filter(s => s && (s.action === 'skip' || s.action === 'speed') && Number.isFinite(+s.start) && Number.isFinite(+s.end) && +s.end > cur && +s.start < dur)
      .map(s => ({
        ...s,
        start: Math.max(cur, +s.start),
        end: Math.min(dur, +s.end),
      }))
      .filter(s => s.end > s.start);

    if (!clamped.length) {
      const realRemainingSec = rawRemainingSec / normalRate;
      return {
        rawRemainingSec,
        realRemainingSec,
        cutsAheadSec: 0,
        finishAtMs: Math.round(now + realRemainingSec * 1000),
      };
    }

    const edges = [...new Set([cur, dur, ...clamped.flatMap(s => [s.start, s.end])])].sort((a, b) => a - b);
    let realRemainingSec = 0;
    let cutsAheadSec = 0;
    for (let i = 0; i < edges.length - 1; i++) {
      const a = edges[i], b = edges[i + 1];
      const len = b - a;
      if (len <= 0) continue;
      const matching = clamped.filter(s => s.start <= a + 1e-6 && s.end >= b - 1e-6);
      if (!matching.length) {
        realRemainingSec += len / normalRate;
      } else if (matching.some(s => s.action === 'skip')) {
        cutsAheadSec += len / normalRate;
      } else {
        const bestRate = Math.max(...matching.map(s => resolveSpeedRate(s, normalRate, configuredSpeed)));
        const wallLen = len / bestRate;
        realRemainingSec += wallLen;
        cutsAheadSec += Math.max(0, len / normalRate - wallLen);
      }
    }
    return {
      rawRemainingSec,
      realRemainingSec: Math.max(0, realRemainingSec),
      cutsAheadSec: Math.max(0, cutsAheadSec),
      finishAtMs: Math.round(now + Math.max(0, realRemainingSec) * 1000),
    };
  }

  function formatRemainingClock(opts = {}) {
    const res = computeRemainingWatchTime(opts);
    const roundedLeft = Math.max(0, Math.round(res.realRemainingSec));
    const label = `· ${fmtStamp(roundedLeft)} left`;
    const finishDate = new Date(res.finishAtMs);
    const hh = String(finishDate.getHours()).padStart(2, '0');
    const mm = String(finishDate.getMinutes()).padStart(2, '0');
    const savedVsRaw = Math.max(0, Math.round(res.rawRemainingSec - res.realRemainingSec));
    const parts = [`Real watch time left: ${fmtStamp(roundedLeft)} (finishes ~${hh}:${mm})`];
    if (res.cutsAheadSec >= 1) parts.push(`${fmtStamp(Math.round(res.cutsAheadSec))} of cuts ahead`);
    else if (savedVsRaw >= 1) parts.push(`saves ${fmtStamp(savedVsRaw)} vs 1×`);
    return { ...res, label, finishClock: `${hh}:${mm}`, title: parts.join(' · ') };
  }

  function advanceAbLoop(loop, currentTime = 0, duration = 0, videoId = '') {
    const vid = String(videoId || '');
    const dur = Number.isFinite(+duration) && +duration > 0 ? +duration : 0;
    const clamp = t => {
      const n = Number.isFinite(+t) && +t >= 0 ? +t : 0;
      return dur > 0 ? Math.min(dur, n) : n;
    };
    const cur = Math.round(clamp(currentTime) * 100) / 100;
    if (!loop || loop.videoId !== vid) {
      return {
        loop: { videoId: vid, start: cur, end: null },
        stage: 'a',
        message: `🔁 Loop start A set at ${fmtStamp(cur)} — press again to set B`,
      };
    }
    if (loop.end === null || !Number.isFinite(+loop.end)) {
      let a = clamp(loop.start);
      let b = cur;
      if (Math.abs(b - a) < 0.4) {
        b = dur > 0 ? Math.min(dur, a + 5) : a + 5;
        if (b - a < 0.4 && dur >= 1) a = Math.max(0, b - Math.min(5, dur));
      } else if (b < a) {
        [a, b] = [b, a];
      }
      a = Math.round(a * 100) / 100;
      b = Math.round(b * 100) / 100;
      return {
        loop: { videoId: vid, start: a, end: b },
        stage: 'ab',
        message: `🔁 Looping ${fmtStamp(a)} → ${fmtStamp(b)} (press again to clear)`,
      };
    }
    return { loop: null, stage: 'off', message: '🔁 Loop cleared' };
  }

  function parseShortsPath(pathname = '', search = '') {
    const m = String(pathname || '').match(/^\/shorts\/([A-Za-z0-9_-]{11})(?:\/|$)/);
    if (!m) return null;
    const videoId = m[1];
    let tSuffix = '';
    if (search) {
      try {
        const params = new URLSearchParams(String(search));
        if (params.get('yqn_keep_short') === '1') return null;
        const rawT = params.get('t');
        if (rawT && /^\d{1,6}s?$/.test(rawT)) tSuffix = `&t=${rawT.endsWith('s') ? rawT : rawT + 's'}`;
      } catch {}
    }
    return { videoId, watchPath: `/watch?v=${videoId}${tSuffix}` };
  }

  function buildFrameFilename(title = '', timeSec = 0) {
    const cleaned = String(title || '')
      .replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '')
      .slice(0, 70)
      .trim() || 'youtube-frame';
    const total = Math.max(0, Math.floor(+timeSec || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const stamp = (h > 0 ? `${h}h` : '') + `${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s`;
    return `${cleaned} - ${stamp}.png`;
  }

  globalThis.YqnControls={defaults,sponsorPattern,presets,presetPatch,preferenceKeys,presetKeys,fmtStamp,normalizeBaseSpeed,cycleQuickSpeed,stepQuickSpeed,shouldAutoAdvancePlaylist,computeThumbnailBadge,computeRemainingWatchTime,formatRemainingClock,advanceAbLoop,parseShortsPath,buildFrameFilename,localDayKey,recordLifetimeSavings,summarizeLifetimeSavings,cleanEdits,editRange,applyEdits,coalesceMicroGaps,annotateSpeechDensity,resolveSpeedRate,effectiveSpeedEnd,nextBoundaryDelayMs,isTimeBuffered,shouldBurstShortSkip,formatSkipToast,tldrReelBudget,buildTldrDigest,formatTldrMarkdown,SavingsTracker,SilenceDetector};
})();
