// Stable phrase colours are shared by the docked and popout canvas renderers.
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
    labelColour = '#17202c',
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

  let previous = Number.NEGATIVE_INFINITY;
  for (const time of (grid ? data.downbeats : []) || []) {
    const x = ((time - start) / (end - start)) * width;
    if (x < 0 || x > width || x - previous < 8 * scale) continue;
    previous = x;
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
