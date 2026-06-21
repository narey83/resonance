import { AtSign, Eye, MessageSquare, Users } from 'lucide-react';
import React from 'react';

// Discovery & social signals — browsing without downloading is a distinct interest signal.
const SocialPulse = ({ data }) => {
  const tiles = [
    { Icon: Eye, key: 'browsed', label: 'Browses', value: data?.browsed },
    {
      Icon: MessageSquare,
      key: 'pm',
      label: 'Private msgs',
      value: data?.privateMessages,
    },
    {
      Icon: Users,
      key: 'room',
      label: 'Room msgs',
      value: data?.roomMessages,
    },
    { Icon: AtSign, key: 'mention', label: 'Mentions', value: data?.mentions },
  ];

  return (
    <div className="section-card">
      <div className="section-card-header">
        <span className="section-card-title">Social Pulse</span>
      </div>
      <div className="social-grid">
        {tiles.map(({ Icon, key, label, value }) => (
          <div
            className="social-tile"
            key={key}
          >
            <Icon
              className="social-icon"
              size={16}
              strokeWidth={1.75}
            />
            <span className="social-value">
              {Number(value ?? 0).toLocaleString()}
            </span>
            <span className="social-label">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SocialPulse;
