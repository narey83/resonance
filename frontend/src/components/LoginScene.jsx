import './LoginScene.css';
import React from 'react';

// A pair of flowing ribbons, rendered locally without video or network requests.
const ribbons = Array.from({ length: 24 }, (_, index) => {
  const offset = index * 11;
  return `M -200 ${540 + offset} C 140 ${100 + offset}, 300 ${940 - offset}, 610 ${590 - offset * 0.5} S 1050 ${180 + offset}, 1400 ${350 + offset}`;
});

const LoginScene = () => (
  <div
    aria-hidden="true"
    className="login-scene"
  >
    <div className="login-scene-halo" />
    <svg
      className="login-scene-ribbon login-scene-ribbon--front"
      fill="none"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1200 1000"
    >
      <defs>
        <linearGradient
          id="login-ribbon-mint"
          x1="0%"
          x2="100%"
          y1="100%"
          y2="0%"
        >
          <stop
            stopColor="#87dec7"
            stopOpacity="0"
          />
          <stop
            offset="0.3"
            stopColor="#87dec7"
          />
          <stop
            offset="0.65"
            stopColor="#c3e9ef"
          />
          <stop
            offset="1"
            stopColor="#9588d9"
            stopOpacity="0"
          />
        </linearGradient>
      </defs>
      {ribbons.map((path, index) => (
        <path
          d={path}
          key={path}
          opacity={0.12 + Math.sin((index / 23) * Math.PI) * 0.5}
          stroke="url(#login-ribbon-mint)"
          strokeWidth="1.2"
        />
      ))}
    </svg>
    <svg
      className="login-scene-ribbon login-scene-ribbon--back"
      fill="none"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1200 1000"
    >
      <defs>
        <linearGradient id="login-ribbon-gold">
          <stop
            stopColor="#b4a2ec"
            stopOpacity="0"
          />
          <stop
            offset="0.45"
            stopColor="#b4a2ec"
          />
          <stop
            offset="0.75"
            stopColor="#e7bf8b"
          />
          <stop
            offset="1"
            stopColor="#e7bf8b"
            stopOpacity="0"
          />
        </linearGradient>
      </defs>
      {ribbons.map((path) => (
        <path
          d={path}
          key={path}
          stroke="url(#login-ribbon-gold)"
          strokeWidth="0.8"
        />
      ))}
    </svg>
    <div className="login-scene-shade" />
  </div>
);

export default LoginScene;
