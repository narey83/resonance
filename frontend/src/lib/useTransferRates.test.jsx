import useTransferRates from './useTransferRates';
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

const Probe = ({ downloads, uploads }) => {
  const rates = useTransferRates(downloads, uploads);
  return <output>{JSON.stringify(rates)}</output>;
};

describe('Compact transfer byte samples', () => {
  let container;
  let now;
  beforeEach(() => {
    now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    container = document.createElement('div');
    document.body.append(container);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    jest.restoreAllMocks();
  });
  const sample = (uploads, downloads = []) => {
    act(() => {
      ReactDOM.render(
        <Probe
          downloads={downloads}
          uploads={uploads}
        />,
        container,
      );
    });
    return JSON.parse(container.textContent);
  };

  it('counts final completion bytes once without counting new IDs as throughput', () => {
    expect.hasAssertions();
    sample([]);
    now += 1_000;
    sample([{ id: 'one', bytesTransferred: 100 }]);
    now += 2_000;
    expect(
      sample([
        { id: 'one', state: 'Completed, Succeeded', bytesTransferred: 500 },
        { id: 'new', bytesTransferred: 9_000 },
      ]),
    ).toStrictEqual({ down: 0, up: 200 });
    now += 1_000;
    expect(sample([{ id: 'one', bytesTransferred: 500 }]).up).toBe(0);
  });
  it('ignores counter resets and measures both directions independently', () => {
    expect.hasAssertions();
    sample([]);
    now += 1_000;
    sample(
      [{ id: 'up', bytesTransferred: 1_000 }],
      [{ id: 'down', bytesTransferred: 100 }],
    );
    now += 1_000;
    expect(
      sample(
        [{ id: 'up', bytesTransferred: 5 }],
        [{ id: 'down', bytesTransferred: 300 }],
      ),
    ).toStrictEqual({ down: 200, up: 0 });
  });
  it('preserves its baseline across rapid duplicate renders', () => {
    expect.hasAssertions();
    sample([]);
    now += 1_000;
    sample([{ id: 'one', bytesTransferred: 100 }]);
    now += 10;
    sample([{ id: 'one', bytesTransferred: 150 }]);
    now += 990;
    expect(sample([{ id: 'one', bytesTransferred: 200 }]).up).toBe(100);
  });
});
