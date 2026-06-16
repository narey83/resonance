import './Tags.css';
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
      </div>
      <div className="tag-manager-content">
        {tab === 'editor' ? <TagEditor /> : <TagSanitization />}
      </div>
    </div>
  );
};

export default Tags;
