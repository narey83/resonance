import './LoadingState.css';
import ResonanceMark from './ResonanceMark';
import React from 'react';

const LoadingState = ({
  children = 'Loading…',
  className = '',
  size = 48,
  ...props
}) => (
  <div
    aria-busy="true"
    className={`resonance-loading ${className}`.trim()}
    role="status"
    {...props}
  >
    <ResonanceMark size={size} />
    <div>{children}</div>
  </div>
);

export default LoadingState;
