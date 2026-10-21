import * as api from '../../lib/converter';
import { getFolders, getTracks } from '../../lib/musicLibrary';
import Converter from './Converter';
import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';

jest.mock('../../lib/musicLibrary', () => ({
  getFolders: jest.fn(),
  getTracks: jest.fn(),
}));
jest.mock('../../lib/converter', () => ({
  CONVERT_FORMATS: ['mp3', 'opus', 'flac', 'wav', 'm4a', 'aac', 'ogg'],
  listConversionJobs: jest.fn(),
  startConversion: jest.fn(),
  getConversionJob: jest.fn(),
  cancelConversion: jest.fn(),
}));
describe('Converter workflow', () => {
  let container;
  const button = (text) =>
    [...container.querySelectorAll('button')].find((item) =>
      item.textContent.includes(text),
    );
  const render = async () => {
    await act(async () => {
      ReactDOM.render(<Converter />, container);
    });
  };

  beforeEach(() => {
    container = document.createElement('div');
    getFolders.mockResolvedValue([
      { path: '/music', name: 'Library', trackCount: 2 },
    ]);
    getTracks.mockResolvedValue({
      tracks: [
        { path: '/music/one.flac', title: 'One', extension: 'flac' },
        { path: '/music/two.m4a', title: 'Two', extension: 'm4a' },
      ],
    });
    api.listConversionJobs.mockResolvedValue([]);
    api.startConversion.mockResolvedValue({
      id: 'job',
      state: 'Completed',
      total: 2,
      converted: 2,
      failed: 0,
      skipped: 0,
      format: 'mp3',
    });
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    jest.clearAllMocks();
  });
  it('requires a reviewed selection and replacement acknowledgement before starting', async () => {
    expect.hasAssertions();
    await render();
    expect(button('Review conversion').disabled).toBe(true);
    act(() => {
      Simulate.change(
        container.querySelector('[aria-label="Select folder Library"]'),
      );
    });
    act(() => {
      Simulate.click(button('Review conversion'));
    });
    expect(button('Start conversion').disabled).toBe(true);
    expect(api.startConversion).not.toHaveBeenCalled();
    act(() => {
      Simulate.change(container.querySelector('.converter-review input'), {
        target: { checked: true },
      });
    });
    await act(async () => {
      Simulate.click(button('Start conversion'));
    });
    expect(api.startConversion).toHaveBeenCalledWith({
      folders: ['/music'],
      paths: [],
      format: 'mp3',
      quality: 2,
    });
    expect(container.textContent).toContain('Conversion complete');
  });
  it('shows only applicable quality settings and recognises the AAC output extension', async () => {
    expect.hasAssertions();
    await render();
    await act(async () => {
      Simulate.click(container.querySelector('.converter-folder-toggle'));
    });
    act(() => {
      Simulate.click(button('AAC / M4A'));
    });
    expect(container.querySelector('.converter-quality')).toBeNull();
    expect(container.textContent).toContain('output extension is .m4a');
    const row = [...container.querySelectorAll('.converter-track')].find(
      (item) => item.textContent.includes('Two'),
    );
    expect(row.textContent).toContain('skipped');
  });
  it('reports start failures without losing the reviewed selection', async () => {
    expect.hasAssertions();
    api.startConversion.mockRejectedValue(new Error('Encoder unavailable'));
    await render();
    act(() => {
      Simulate.change(
        container.querySelector('[aria-label="Select folder Library"]'),
      );
    });
    act(() => {
      Simulate.click(button('Review conversion'));
    });
    act(() => {
      Simulate.change(container.querySelector('.converter-review input'), {
        target: { checked: true },
      });
    });
    await act(async () => {
      Simulate.click(button('Start conversion'));
    });
    expect(container.querySelector('[role="alert"]').textContent).toContain(
      'Encoder unavailable',
    );
    expect(button('Start conversion').disabled).toBe(false);
  });
});
