import { getMediaAudioGraph } from './mediaAudioGraph';

jest.mock('./prefs', () => ({ get: jest.fn((_key, fallback) => fallback) }));

describe('shared media audio graph', () => {
  it('migrates a cached Processing graph after hot reload without creating a second media source', () => {
    expect.hasAssertions();
    const node = () => ({
      connect: jest.fn(),
      disconnect: jest.fn(),
      gain: { value: 1, setTargetAtTime: jest.fn() },
    });
    const context = {
      createGain: jest.fn(node),
      createWaveShaper: jest.fn(node),
      createMediaElementSource: jest.fn(),
      destination: node(),
    };
    const cached = {
      context,
      source: node(),
      processing: { dry: node(), wet: node() },
    };
    const audio = document.createElement('audio');
    Object.defineProperty(audio, '__resonanceAudioGraph', { value: cached });

    expect(getMediaAudioGraph(audio)).toBe(cached);
    expect(cached.processing.dry.disconnect).toHaveBeenCalledTimes(1);
    expect(cached.processing.wet.disconnect).toHaveBeenCalledTimes(1);
    expect(cached.studio).toBeDefined();
    expect(context.createMediaElementSource).not.toHaveBeenCalled();
    expect(getMediaAudioGraph(audio).studio).toBe(cached.studio);
  });
});
