import './Tags.css';
import MetadataLookup from '../MetadataLookup/MetadataLookup';
import TagEditor from '../TagEditor/TagEditor';
import TagSanitization from '../TagSanitization/TagSanitization';
import React, { useState } from 'react';

const Tags = () => {
  const [tab, setTab] = useState('editor');

  return (
    <div className="tag-manager">
      <div className="tag-manager-tabs">
        <button
          className={`tag-manager-tab${tab === 'editor' ? ' tag-manager-tab--active' : ''}`}
          onClick={() => setTab('editor')}
          type="button"
        >
          Editor
        </button>
        <button
          className={`tag-manager-tab${tab === 'sanitize' ? ' tag-manager-tab--active' : ''}`}
          onClick={() => setTab('sanitize')}
          type="button"
        >
          Sanitize
        </button>
        <button
          className={`tag-manager-tab${tab === 'lookup' ? ' tag-manager-tab--active' : ''}`}
          onClick={() => setTab('lookup')}
          type="button"
        >
          Online lookup
        </button>
      </div>
      <div className="tag-manager-content">
        {tab === 'editor' && <TagEditor />}
        {tab === 'sanitize' && <TagSanitization />}
        {tab === 'lookup' && <MetadataLookup />}
      </div>
    </div>
  );
};

export default Tags;
