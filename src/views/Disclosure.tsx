import { useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Collapsible block for the insight page.
 *
 * That page grew into nine stacked sections and pushed everything below the fold;
 * each one is now independently collapsible so the whole page fits on a screen
 * at a glance. Defaults reflect what a first-time reader needs: overview open,
 * long tables closed.
 */
export function Disclosure(props: {
  title: ReactNode;
  /** Shown on the right of the header, e.g. a row count. */
  meta?: ReactNode;
  /** Start expanded. Long tables default to collapsed. */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);

  return (
    <section className={'insight-block' + (open ? ' open' : '')}>
      <button
        type="button"
        className="insight-block-head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="insight-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="insight-block-title">{props.title}</span>
        {props.meta != null && <span className="insight-block-meta">{props.meta}</span>}
      </button>
      {open && <div className="insight-block-body">{props.children}</div>}
    </section>
  );
}
