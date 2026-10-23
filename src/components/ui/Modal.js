import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './Button';

function useEscape(onClose) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}

// Overlays render into <body>, so a card's hover lift (a transform) or its
// overflow clipping never repositions or cuts them off.
const portal = (node) => createPortal(node, document.body);

function PanelHeader({ eyebrow, title, subtitle, extra, onClose }) {
  return (
    <div className="panel-header">
      <div className="min-w-0">
        {eyebrow && <p className="label-caps mb-0.5">{eyebrow}</p>}
        <h2 className="panel-title">{title}</h2>
        {subtitle && <p className="text-xs text-fg-muted mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {extra}
        <IconButton icon="close" label="Close" plain onClick={onClose} />
      </div>
    </div>
  );
}

/** Modal: centred dialog. Render it conditionally: {open && <Modal …/>} */
export default function Modal({ title, eyebrow, subtitle, onClose, footer, width = 560, children }) {
  useEscape(onClose);
  return portal(
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="modal" style={{ '--modal-w': `${width}px` }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <PanelHeader eyebrow={eyebrow} title={title} subtitle={subtitle} onClose={onClose} />
        <div className="modal-body">{children}</div>
        {footer && <div className="panel-footer">{footer}</div>}
      </div>
    </div>,
  );
}

/** Drawer: full-height panel that slides in from the right. */
export function Drawer({ title, eyebrow, subtitle, headerExtra, onClose, footer, width = 420, bodyClassName = 'p-5 overflow-y-auto', children }) {
  useEscape(onClose);
  return portal(
    <div className="overlay overlay-right" onClick={onClose}>
      <div className="drawer" style={{ '--drawer-w': `${width}px` }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <PanelHeader eyebrow={eyebrow} title={title} subtitle={subtitle} extra={headerExtra} onClose={onClose} />
        <div className={`flex-1 min-h-0 ${bodyClassName}`}>{children}</div>
        {footer && <div className="panel-footer">{footer}</div>}
      </div>
    </div>,
  );
}

/** DetailGrid: label/value tiles, for record details inside modals. */
export function DetailGrid({ items, columns = 2 }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {items.map(({ label, value }) => (
        <div key={label} className="tile">
          <p className="label-caps mb-1">{label}</p>
          <div className="text-sm font-bold text-fg tabular-nums">{value}</div>
        </div>
      ))}
    </div>
  );
}
