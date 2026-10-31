import React from 'react';

const UploadQueuePagination = ({
  onPageChange,
  page,
  pageSize = 250,
  total,
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
          Pending uploads: {first.toLocaleString()}–{last.toLocaleString()} of{' '}
          {total.toLocaleString()}
        </strong>
        <div>
          User and folder counts refer to this page. Cancelling a user or folder
          applies to their whole queue.
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
        <span>
          {page + 1} / {pages}
        </span>
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
