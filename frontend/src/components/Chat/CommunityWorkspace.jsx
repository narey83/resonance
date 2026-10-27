import React from 'react';

const CommunityWorkspace = ({
  action,
  children,
  description,
  eyebrow = 'SOULSEEK COMMUNITY',
  title,
}) => (
  <section className="community-workspace">
    <header className="sr-workspace-header community-heading">
      <div>
        <span className="sr-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
    <div className="community-body">{children}</div>
  </section>
);

export default CommunityWorkspace;
