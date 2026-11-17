import type { FlagsPage } from './api';

interface Props {
  label: string;
  page: FlagsPage;
  offset: number;
  onOffsetChange: (offset: number) => void;
}

/** Previous and next buttons with "Page X of Y". Hidden when there is nothing to page through. */
export function Pager({ label, page, offset, onOffsetChange }: Props) {
  if (page.total === 0) return null;
  const size = page.limit;
  const pages = Math.max(1, Math.ceil(page.total / size));
  const current = Math.min(pages, Math.floor(page.offset / size) + 1);
  return (
    <nav className="pager" aria-label={label}>
      <button type="button" disabled={offset === 0} onClick={() => onOffsetChange(Math.max(0, offset - size))}>
        Previous
      </button>
      <span className="pager-status">
        Page {current} of {pages}
      </span>
      <button type="button" disabled={current >= pages} onClick={() => onOffsetChange(offset + size)}>
        Next
      </button>
    </nav>
  );
}
