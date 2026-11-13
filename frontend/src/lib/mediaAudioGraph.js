// SPDX-License-Identifier: AGPL-3.0-only
import { readStudio } from './dsp/studioConfig';
import { StudioEngine } from './dsp/StudioEngine';
import * as prefs from './prefs';

// A MediaElementSourceNode can be created only once for an audio element.
// Keep the graph on the element so development hot reload cannot lose it.
const GRAPH_PROPERTY = '__resonanceAudioGraph';

const startStudio = (studio) => {
  const saved = readStudio(prefs.get('mediaPlayer.studio.v1', null));
  studio.configure({
    ...saved.profiles[saved.output],
    pushed: false,
    bypass: false,
  });
  // The guarded direct path stays connected if loading fails.
  void studio.setMode(true).catch(() => {});
};

export const getMediaAudioGraph = (audioElement) => {
  if (!audioElement) return null;
  const cached = audioElement[GRAPH_PROPERTY];
  if (cached) {
    if (!cached.studio) {
      // Development hot reload can retain the old media element and its DSP
      // graph. Disconnect its outputs; MediaElementSource cannot be recreated.
      cached.processing?.dry?.disconnect();
      cached.processing?.wet?.disconnect();
      cached.studio = new StudioEngine(
        cached.context,
        cached.source,
        cached.context.destination,
      );
      startStudio(cached.studio);
    }

    return cached;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextClass();
  const source = context.createMediaElementSource(audioElement);
  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 60;
  const highshelf = context.createBiquadFilter();
  highshelf.type = 'highshelf';
  highshelf.frequency.value = 1_500;
  highshelf.gain.value = 4;
  const analyser = context.createAnalyser();
  analyser.fftSize = 2_048;
  analyser.smoothingTimeConstant = 0;

  source.connect(highpass);
  highpass.connect(highshelf);
  highshelf.connect(analyser);

  const studio = new StudioEngine(context, source, context.destination);
  startStudio(studio);

  const graph = {
    analyser,
    analyserBuffer: new Float32Array(analyser.fftSize),
    context,
    source,
    studio,
  };
  audioElement[GRAPH_PROPERTY] = graph;
  return graph;
};

export const peekMediaAudioGraph = (audioElement) =>
  audioElement?.[GRAPH_PROPERTY] ?? null;
