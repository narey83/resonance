// Stable phrase colours for the player waveform and its arrangement sections.
export const phraseColour = (label = '') => {
  const value = label.toLowerCase();
  if (/intro|outro|instrumental/.test(value)) return '#475569';
  if (/breakdown|bridge/.test(value)) return '#245da8';
  if (/build|entrance|pre.chorus/.test(value)) return '#925b0b';
  if (/drop/.test(value)) return '#ac3454';
  if (/high.energy|chorus/.test(value)) return '#7444aa';
  if (/groove|verse/.test(value)) return '#086f73';
  return '#565e72';
};

export const visibleSpans = (segments, start, end, width, snake = false) =>
  (segments || []).flatMap((segment) => {
    const lo = Number(segment[snake ? 'start_seconds' : 'startSeconds']);
    const hi = Number(segment[snake ? 'end_seconds' : 'endSeconds']);
    if (
      !Number.isFinite(lo) ||
      !Number.isFinite(hi) ||
      hi <= lo ||
      hi <= start ||
      lo >= end ||
      end <= start
    )
      return [];
    return [
      {
        ...segment,
        x: Math.max(0, ((lo - start) / (end - start)) * width),
        width:
          ((Math.min(end, hi) - Math.max(start, lo)) / (end - start)) * width,
      },
    ];
  });

// The legacy activity analyser gave a whole section the name of a point event.
// Keep that stored evidence intact and distinguish the two in both player views.
const djTimelineCache = new WeakMap();
export const djTimeline = (data) => {
  if (!data || typeof data !== 'object') return { sections: [], events: [] };
  if (djTimelineCache.has(data)) return djTimelineCache.get(data);
  const sections =
    data.djHierarchy?.sections || data.djSections || data.djPhrases || [];
  const events = [...(data.djHierarchy?.events || data.djEvents || [])];
  const normalized = sections.map((section) => {
    if (section.label !== 'Drop entrance') return section;
    const seconds = section.start_seconds;
    if (
      typeof seconds === 'number' &&
      Number.isFinite(seconds) &&
      !events.some(
        (event) => event.type === 'drop_entrance' && event.seconds === seconds,
      )
    )
      events.push({
        type: 'drop_entrance',
        seconds,
        source: 'legacy-activity-evidence',
      });
    const evidence = section.featureEvidence || {};
    return {
      ...section,
      label:
        evidence.drumLevel > 1.15 && evidence.bassLevel > 0.55
          ? 'High-energy groove'
          : 'Groove',
      legacyLabel: section.label,
    };
  });
  const result = { sections: normalized, events };
  djTimelineCache.set(data, result);
  return result;
};

export const visibleEvents = (events, start, end, width) => {
  if (![start, end, width].every(Number.isFinite) || end <= start || width <= 0)
    return [];
  return (events || []).flatMap((event) => {
    const seconds = event.seconds;
    if (
      typeof seconds !== 'number' ||
      !Number.isFinite(seconds) ||
      seconds < 0 ||
      seconds < start ||
      seconds >= end
    )
      return [];
    return [{ ...event, x: ((seconds - start) / (end - start)) * width }];
  });
};

// Independent downbeats establish bar positions, but cannot establish a 16- or
// 32-bar phrase phase by themselves. Repeated section boundaries must agree on
// a residue before either accent is shown. Continue counting through irregular
// sections rather than restarting at each boundary.
const phraseBarCache = new WeakMap();
export const phraseBarMarkers = (data, phrases = 'dj') => {
  if (!data?.available || !Array.isArray(data.downbeats)) return [];
  let cached = phraseBarCache.get(data);
  if (!cached) {
    cached = new Map();
    phraseBarCache.set(data, cached);
  }

  const mode = phrases === 'musical' ? 'musical' : 'dj';
  if (cached.has(mode)) return cached.get(mode);

  const downbeats = data.downbeats;
  if (
    !downbeats.length ||
    downbeats.some(
      (time, index) =>
        !Number.isFinite(time) || (index > 0 && time <= downbeats[index - 1]),
    )
  )
    return [];
  const barIntervals = downbeats
    .slice(1)
    .map((time, index) => time - downbeats[index]);
  const orderedIntervals = [...barIntervals].sort(
    (left, right) => left - right,
  );
  const middleInterval =
    orderedIntervals[Math.floor(orderedIntervals.length / 2)];
  // A missing downbeat shifts every later array index. A large unexplained
  // spacing jump invalidates continuous phrase counting, including through a
  // pause where the number of silent bars cannot be inferred from this array.
  if (
    middleInterval &&
    barIntervals.some(
      (interval) =>
        interval < middleInterval * 0.55 || interval > middleInterval * 1.7,
    )
  )
    return [];
  const selected =
    mode === 'musical' ? data.musicalPhrases : djTimeline(data).sections;
  const sections = Array.isArray(selected) ? selected : [];
  const nearestBar = (seconds) => {
    const after = downbeats.findIndex((time) => time >= seconds);
    if (after < 0) return -1;
    const index =
      after > 0 && seconds - downbeats[after - 1] < downbeats[after] - seconds
        ? after - 1
        : after;
    const adjacent = [
      index > 0
        ? downbeats[index] - downbeats[index - 1]
        : Number.POSITIVE_INFINITY,
      index + 1 < downbeats.length
        ? downbeats[index + 1] - downbeats[index]
        : Number.POSITIVE_INFINITY,
    ];
    const tolerance = Math.min(0.35, Math.min(...adjacent) * 0.2);
    return Math.abs(downbeats[index] - seconds) <= tolerance ? index : -1;
  };

  const boundaries = [
    ...new Set(
      sections.flatMap((section) => {
        const start = section?.start_seconds;
        if (
          !Number.isFinite(start) ||
          !Number.isFinite(section.end_seconds) ||
          section.end_seconds <= start ||
          start < downbeats[0] ||
          start > downbeats.at(-1)
        )
          return [];
        const bar = nearestBar(start);
        return bar < 0 ? [] : [bar];
      }),
    ),
  ];
  // The earliest section starts the reported arrangement by construction,
  // even when the analyser omitted an earlier intro. It cannot count as a
  // second independent phrase event.
  const firstBoundary = Math.min(...boundaries);
  const votes = boundaries.filter((bar) => bar !== firstBoundary);
  const supportedPhase = (span) => {
    const groups = new Map();
    for (const bar of votes) {
      const residue = bar % span;
      groups.set(residue, [...(groups.get(residue) || []), bar]);
    }

    const ranked = [...groups].sort(
      ([, left], [, right]) => right.length - left.length,
    );
    const winner = ranked[0];
    const runnerCount = ranked[1]?.[1].length || 0;
    if (
      !winner ||
      winner[1].length < 2 ||
      winner[1].length - runnerCount < (runnerCount ? 2 : 1) ||
      Math.max(...winner[1]) - Math.min(...winner[1]) < span
    )
      return null;
    return winner[0];
  };

  let phase16 = supportedPhase(16);
  let phase32 = supportedPhase(32);
  if (phase32 != null) {
    if (phase16 == null) phase16 = phase32 % 16;
    else if (phase16 !== phase32 % 16) phase32 = null;
  }

  const strongestSpan = phase32 == null ? 16 : 32;
  const strongestPhase = phase32 ?? phase16;
  const firstSupportedBoundary =
    firstBoundary % strongestSpan === strongestPhase
      ? firstBoundary
      : Math.min(
          ...votes.filter((bar) => bar % strongestSpan === strongestPhase),
        );
  const result = [];
  if (phase16 != null) {
    for (let index = phase16; index < downbeats.length; index += 16)
      if (index >= firstSupportedBoundary)
        result.push({
          time: downbeats[index],
          level: phase32 != null && index % 32 === phase32 ? 2 : 1,
        });
  }

  cached.set(mode, result);
  return result;
};

export const drawEnhanced = (ctx, data, options) => {
  if (!data?.available) return;
  const {
    start,
    end,
    width,
    height,
    phrases,
    vocals,
    scale = 1,
    grid = true,
    gridColour = 'rgba(30,80,200,0.65)',
    gridOutline = null,
    detailGrid = false,
    downbeatGrid = true,
    markers: markerOverride,
    labelColour = '#17202c',
    barMarkerColours = {},
    labelBackground = '#ffffff',
  } = options;
  const timeline = djTimeline(data);
  ctx.save();
  if (phrases !== 'off') {
    for (const span of visibleSpans(
      phrases === 'musical' ? data.musicalPhrases : timeline.sections,
      start,
      end,
      width,
      true,
    )) {
      const colour = phraseColour(span.label);
      // Keep the waveform, vocal lanes and beat positions clear under the tint.
      ctx.save();
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = colour;
      ctx.fillRect(
        span.x,
        13 * scale,
        span.width,
        Math.max(0, height - 25 * scale),
      );
      ctx.restore();
      ctx.fillStyle = colour;
      ctx.fillRect(span.x, 0, span.width, 13 * scale);
      if (span.width > 70 * scale) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(span.x, 0, span.width - 2, 14 * scale);
        ctx.clip();
        ctx.fillStyle = '#ffffff';
        ctx.font = `${10 * scale}px sans-serif`;
        ctx.fillText?.(span.label, span.x + 3 * scale, 10 * scale);
        ctx.restore();
      }
    }
  }

  if (vocals)
    for (const [segments, colour, y] of [
      [data.singing, '#008c95', height - 8 * scale],
      [data.processedVoice, '#db9018', height - 4 * scale],
    ]) {
      ctx.fillStyle = colour;
      for (const span of visibleSpans(segments, start, end, width))
        ctx.fillRect(span.x, y, span.width, 3 * scale);
    }

  const markers = grid ? markerOverride ?? phraseBarMarkers(data, phrases) : [];
  let previous = Number.NEGATIVE_INFINITY;
  for (const time of (grid && downbeatGrid ? data.downbeats : []) || []) {
    const x = ((time - start) / (end - start)) * width;
    if (x < 0 || x > width || x - previous < 8 * scale) continue;
    previous = x;
    // The phrase marker is the accent at this downbeat, so do not paint a
    // second grid line underneath it.
    if (
      markers.some(
        (marker) =>
          Math.abs(((marker.time - start) / (end - start)) * width - x) <=
          ((marker.level === 3 ? 2 : marker.level === 2 ? 1.5 : 0.5) +
            (detailGrid ? 2 : 0.5)) *
            scale,
      )
    )
      continue;
    const lineHeight = Math.max(0, height - 22 * scale);
    if (detailGrid && gridOutline) {
      ctx.fillStyle = gridOutline;
      ctx.fillRect(x - 2 * scale, 14 * scale, 6 * scale, lineHeight);
    }

    ctx.fillStyle = gridColour;
    ctx.fillRect(x, 14 * scale, (detailGrid ? 2 : 1) * scale, lineHeight);
    if (detailGrid) {
      // Wider caps distinguish the first beat of each bar from other beats.
      ctx.fillRect(x - 3 * scale, 14 * scale, 8 * scale, 5 * scale);
    }
  }

  if (grid) {
    const lineHeight = Math.max(0, height - 14 * scale);
    ctx.save();
    for (const marker of markers) {
      const x = ((marker.time - start) / (end - start)) * width;
      if (x < 0 || x > width) continue;
      const lineWidth =
        (marker.level === 3 ? 4 : marker.level === 2 ? 3 : 1) * scale;
      if (gridOutline) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = gridOutline;
        ctx.fillRect(
          x - lineWidth / 2 - scale,
          14 * scale,
          lineWidth + 2 * scale,
          lineHeight,
        );
      }

      ctx.globalAlpha = 0.95;
      ctx.fillStyle = barMarkerColours[marker.level] || labelColour;
      ctx.fillRect(x - lineWidth / 2, 14 * scale, lineWidth, lineHeight);
    }

    ctx.restore();
  }

  // Event markers use the exact same source-time window as phrases and seeking.
  // A triangle marks an instant; it does not imply a drop lasting the whole span.
  if (phrases !== 'off' && phrases !== 'musical' && height >= 28 * scale) {
    for (const event of visibleEvents(timeline.events, start, end, width)) {
      if (event.type !== 'drop_entrance') continue;
      const y = 15 * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 13 * scale, width, Math.max(0, height - 25 * scale));
      ctx.clip();
      ctx.fillStyle = labelBackground;
      ctx.fillRect(
        event.x - 2 * scale,
        y + 7 * scale,
        4 * scale,
        Math.max(0, height - y - 20 * scale),
      );
      ctx.fillStyle = '#ac3454';
      ctx.fillRect(
        event.x - scale,
        y + 7 * scale,
        2 * scale,
        Math.max(0, height - y - 20 * scale),
      );
      ctx.beginPath();
      ctx.moveTo(event.x - 5 * scale, y);
      ctx.lineTo(event.x + 5 * scale, y);
      ctx.lineTo(event.x, y + 8 * scale);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = labelBackground;
      ctx.lineWidth = scale;
      ctx.stroke();
      if (height >= 40 * scale && width - event.x > 42 * scale) {
        ctx.font = `${10 * scale}px sans-serif`;
        const textWidth = ctx.measureText('Drop').width;
        ctx.fillStyle = labelBackground;
        ctx.fillRect(event.x + 5 * scale, y, textWidth + 4 * scale, 12 * scale);
        ctx.fillStyle = labelColour;
        ctx.fillText('Drop', event.x + 7 * scale, y + 10 * scale);
      }

      ctx.restore();
    }
  }

  ctx.restore();
};
