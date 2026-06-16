import React from 'react';

const ResonanceMark = ({ size = 24 }) => (
  <svg
    fill="none"
    height={size}
    viewBox="0 0 24 24"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle
      cx="12"
      cy="12"
      r="8"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path
      d="M4 12 C6 6.5 10 6.5 12 12 C14 17.5 18 17.5 20 12"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
    />
  </svg>
);

export default ResonanceMark;
