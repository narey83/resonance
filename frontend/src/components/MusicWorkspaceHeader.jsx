import { urlBase } from '../config';
import { ArrowUpRight, AudioWaveform, Disc3, Unplug } from 'lucide-react';
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
  <header
    className={`dj-workspace-header${page === 'export' ? ' dj-workspace-header--export' : ''}`}
  >
    <div className="dj-workspace-heading">
      <Disc3
        aria-hidden="true"
        size={16}
      />
      <h1>{pages[page] ?? pages.library}</h1>
    </div>
    <div className="dj-workspace-actions">
      {!['trackanalysis', 'networklink', 'export', 'converter'].includes(
        page,
      ) && (
        <Link to={`${urlBase}/trackanalysis`}>
          <AudioWaveform size={16} /> Analyse
        </Link>
      )}
      {page === 'export' && (
        <>
          <a
            href="http://127.0.0.1:55460/usb#eject"
            rel="noopener noreferrer"
            target="_blank"
            title="Choose and safely eject a USB drive on the computer running Bridge"
          >
            <Unplug size={14} /> Safely eject in Bridge
          </a>
          <Link to={`${urlBase}/library`}>
            Back to collection <ArrowUpRight size={14} />
          </Link>
        </>
      )}
    </div>
  </header>
);
export default MusicWorkspaceHeader;
