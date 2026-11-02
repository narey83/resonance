import React from 'react';

const UploadQueuePagination = ({
  onPageChange,
  page,
  pageSize = 250,
  total,
  username,
}) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : page * pageSize + 1;
  const last = Math.min((page + 1) * pageSize, total);
  return (
    <nav
      aria-label="Pending uploads pages"
      className="ul-queue-pagination"
    >
      <div>
        <strong>
          {username ? `${username} · ` : ''}Queue page {page + 1} of {pages}
        </strong>
        <div>
          {total === 0
            ? 'No tracks left to send'
            : `Tracks ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} · up to ${pageSize} per page`}
        </div>
      </div>
      <div className="ul-pagination">
        <button
          aria-label="Previous pending uploads page"
          className="ul-page-btn"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
          type="button"
        >
          Previous
        </button>
        <button
          aria-label="Next pending uploads page"
          className="ul-page-btn"
          disabled={page + 1 >= pages}
          onClick={() => onPageChange(page + 1)}
          type="button"
        >
          Next
        </button>
      </div>
    </nav>
  );
};

export default UploadQueuePagination;
