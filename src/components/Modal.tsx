import type { ReactNode } from 'react';

export function Modal({ title, onClose, children, width }: {
  title: string; onClose: () => void; children: ReactNode; width?: number;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { maxWidth: width } : undefined}>
        <div className="page-head">
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="small" onClick={onClose}>关闭 ✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
