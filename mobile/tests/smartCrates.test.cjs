const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { mobileModules, deferred, tick } = require('./helpers.cjs');
const tracks = Array.from({ length: 350 }, (_, index) => ({ path: `/music/${index}.mp3`, title: `Track ${index}`, filename: `${index}.mp3` }));

function screen() {
  const slots = [], effects = [], requests = [], queues = [], signatures = [];
  let cursor = 0, queueResponse;
  const state = initial => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
  };
  const effect = (callback, deps) => {
    const index = cursor++;
    const previous = slots[index];
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
    previous?.cleanup?.();
    const entry = { deps };
    slots[index] = entry;
    effects.push(() => { entry.cleanup = callback(); });
  };
  const load = mobileModules({
    react: { ...React, useState: state, useRef: initial => state(() => ({ current: initial }))[0], useMemo: factory => factory(), useEffect: effect },
    'react-native': { ActivityIndicator: 'ActivityIndicator', FlatList: 'FlatList', Pressable: 'Pressable', Text: 'Text', View: 'View' },
    'src/components/Typography.tsx': { Text: 'Text', TextInput: 'TextInput' },
    'src/context/ThemeContext.ts': { useTheme: () => ({ colors: {} }) },
    'src/context/PlayerContext.tsx': { MAX_QUEUE: 200, LEAD_IN: 50, usePlayer: () => ({ playQueue: async (...args) => { queues.push(args); } }) },
    'src/store/libraryActivityStore.ts': { useLibraryActivityStore: selector => selector({ libraryRevision: 0 }) },
    'src/theme.ts': { Editorial: {} },
    'src/api/musicLibrary.ts': { seedTrackSignatures: values => signatures.push(values), getTrackTitle: track => track.title },
    'src/api/client.ts': { apiClient: { get: async (url, options) => {
      requests.push({ url, ...options });
      if (url.endsWith('/crates')) return { data: { crates: [{ id: 'genre/techno', name: 'Techno', trackCount: tracks.length }] } };
      if (options.params.limit === 200 && queueResponse) return queueResponse();
      return { data: { tracks: tracks.slice(options.params.offset, options.params.offset + options.params.limit), total: tracks.length } };
    } } },
  }, { setTimeout: () => 0, clearTimeout: () => {} });
  const Screen = load('src/screens/library/SmartCratesTab.tsx').default;
  let tree;
  const render = () => { cursor = 0; tree = Screen(); effects.splice(0).forEach(run => run()); };
  const nodes = () => {
    const result = [];
    const visit = node => { if (!React.isValidElement(node)) return; result.push(node); React.Children.forEach(node.props.children, visit); };
    visit(tree); return result;
  };
  const list = () => nodes().find(node => node.type === 'FlatList');
  const open = async () => {
    render(); await tick(); render();
    const props = list().props;
    props.renderItem({ item: props.data[0], index: 0 }).props.onPress();
    render(); await tick(); render();
  };
  const pressTrack = index => { const props = list().props; return props.renderItem({ item: props.data[index], index }).props.onPress(); };
  const nextPage = async () => {
    const button = nodes().find(node => node.type === 'Pressable' && React.Children.toArray(node.props.children).some(child => child.props?.children === 'Next'));
    button.props.onPress(); render(); await tick(); render();
  };
  const close = () => { slots.forEach(slot => slot?.cleanup?.()); };
  const message = () => nodes().filter(node => node.type === 'Text').map(node => node.props.children).join(' ');
  return { open, pressTrack, nextPage, queues, signatures, requests, render, close, message, respond: fn => { queueResponse = fn; } };
}

test('opening a smart crate stays paused; tapping queues following tracks beyond its first page', async () => {
  const ui = screen(); await ui.open();
  assert.equal(ui.queues.length, 0);
  ui.pressTrack(99); await tick(); ui.render();
  assert.deepEqual(ui.requests.at(-1), { url: '/musiclibrary/crates/genre%2Ftechno/tracks', params: { limit: 200, offset: 49, sort: 'title' } });
  const [queued, index] = ui.queues[0];
  assert.equal(queued.length, 200); assert.equal(index, 50);
  assert.equal(queued[index].path, tracks[99].path);
  assert.equal(queued[index + 1].path, tracks[100].path);
  assert.deepEqual(ui.signatures.at(-1), queued); ui.close();
});

test('later-page selections retain crate order and select the tapped identity within the queue', async () => {
  const ui = screen(); await ui.open(); await ui.nextPage();
  ui.pressTrack(30); await tick();
  assert.equal(ui.requests.at(-1).params.offset, 80);
  assert.equal(ui.queues[0][0][ui.queues[0][1]].path, tracks[130].path);
  assert.equal(ui.queues[0][0][ui.queues[0][1] + 1].path, tracks[131].path); ui.close();
});

test('failed or changed membership does not replace an existing playback queue', async () => {
  const ui = screen(); await ui.open();
  ui.respond(async () => { throw new Error('offline'); });
  ui.pressTrack(0); await tick(); ui.render();
  assert.equal(ui.queues.length, 0); assert.match(ui.message(), /Could not load the crate playback queue/);
  ui.respond(async () => ({ data: { tracks: [], total: 0 } }));
  ui.pressTrack(0); await tick(); ui.render();
  assert.equal(ui.queues.length, 0); assert.match(ui.message(), /no longer in this crate/); ui.close();
});

test('older or unmounted playback requests cannot start a queue', async () => {
  const ui = screen(); await ui.open();
  const old = deferred(); ui.respond(() => old.promise); ui.pressTrack(0);
  ui.respond(async () => ({ data: { tracks, total: tracks.length } })); ui.pressTrack(1); await tick();
  old.resolve({ data: { tracks, total: tracks.length } }); await tick();
  assert.equal(ui.queues.length, 1); assert.equal(ui.queues[0][1], 1);
  const closing = deferred(); ui.respond(() => closing.promise); ui.pressTrack(2); ui.close();
  closing.resolve({ data: { tracks, total: tracks.length } }); await tick(); assert.equal(ui.queues.length, 1);
});
