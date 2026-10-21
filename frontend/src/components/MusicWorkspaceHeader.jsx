import { urlBase } from '../config';
import { ArrowUpRight, AudioWaveform, Disc3, Usb } from 'lucide-react';
import React from 'react';
import { Link } from 'react-router-dom';

const pages = {
  library: 'Your collection',
  trackanalysis: 'Prepare your music',
  export: 'Take your set with you',
  networklink: 'Play across your network',
  tags: 'Track metadata',
  duplicates: 'Clean up your collection',
  converter: 'Audio converter',
};
const MusicWorkspaceHeader = ({ page }) => (
  <header className="dj-workspace-header">
    <div className="dj-workspace-heading">
      <Disc3
        aria-hidden="true"
        size={16}
      />
      <h1>{pages[page] ?? pages.library}</h1>
    </div>
    <div className="dj-workspace-actions">
      {page !== 'trackanalysis' && (
        <Link to={`${urlBase}/trackanalysis`}>
          <AudioWaveform size={16} /> Analyse
        </Link>
      )}
      {page !== 'export' && (
        <Link
          className="dj-primary-action"
          to={`${urlBase}/export`}
        >
          <Usb size={16} /> Export set <ArrowUpRight size={14} />
        </Link>
      )}
      {page === 'export' && (
        <Link to={`${urlBase}/library`}>
          Back to collection <ArrowUpRight size={14} />
        </Link>
      )}
    </div>
  </header>
);
export default MusicWorkspaceHeader;
