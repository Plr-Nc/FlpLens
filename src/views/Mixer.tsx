import { useMemo, useState } from 'react';
import type { Project } from '../flp/project.ts';
import { pluginLabel } from '../flp/project.ts';

/**
 * Mixer inserts as a signal-flow list.
 *
 * The previous view was a card grid: 117 inserts at 4 columns meant six screens
 * of scrolling, half of the cards said "空", and a card with one effect was the
 * same height as one with eight — that is dashboard layout, not instrument
 * layout. A bus is a chain, so it is drawn as one line per insert: index, name,
 * then the effects in order with arrows between them. Text density goes up,
 * vertical cost goes down, and the order of the chain becomes visible at a
 * glance, which the grid never showed.
 */
export function Mixer(props: { project: Project }) {
  const [showEmpty, setShowEmpty] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  const all = useMemo(
    () =>
      props.project.mixer.map((insert) => ({
        ...insert,
        // Event 98 fires for every slot of every insert, loaded or not; only
        // slots that actually name something are interesting in a read-only view.
        slots: insert.slots.filter((slot) => slot.internalName || slot.name || slot.vst),
      })),
    [props.project.mixer],
  );

  const used = all.filter((insert) => insert.slots.length > 0 || insert.name !== '');
  const needle = query.trim().toLowerCase();
  const rows = (showEmpty ? all : used).filter((insert) => {
    if (!needle) return true;
    if (insert.name.toLowerCase().includes(needle)) return true;
    // Matching the chain as well is what makes this useful: "where did I put
    // the tape stop" is a question about an effect, not about a bus name.
    return insert.slots.some((slot) =>
      `${pluginLabel(slot)} ${slot.internalName} ${slot.vst?.vendor ?? ''}`
        .toLowerCase()
        .includes(needle),
    );
  });
  const emptyCount = all.length - used.length;
  const totalFx = used.reduce((sum, insert) => sum + insert.slots.length, 0);

  if (all.length === 0) {
    return <div className="empty">这个工程没有可显示的混音台信息</div>;
  }

  return (
    <div className="panel mixer-panel">
      <div className="mixer-bar">
        <span className="mixer-stat">
          <b>{used.length}</b> 个使用中的 insert
        </span>
        <span className="mixer-stat">
          <b>{totalFx}</b> 个已加载效果
        </span>
        <input
          className="mixer-filter"
          placeholder="搜索 insert 或效果器"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          spellCheck={false}
        />
        {emptyCount > 0 && (
          <label className="mixer-toggle">
            <input
              type="checkbox"
              checked={showEmpty}
              onChange={(event) => setShowEmpty(event.target.checked)}
            />
            显示 {emptyCount} 个空 insert
          </label>
        )}
      </div>

      <div className="mixer-table">
        <div className="mixer-row mixer-row-head">
          <span className="col-num">#</span>
          <span className="col-name">名称</span>
          <span className="col-chain">效果器链（按信号顺序）</span>
          <span className="col-count">数量</span>
        </div>

        {rows.map((insert) => {
          const open = expanded === insert.index;
          /* Long chains default to a single clipped line; expanding one row at a
             time keeps the list scannable while still allowing a full read. */
          const clipped = !open && insert.slots.length > 6;
          const shown = clipped ? insert.slots.slice(0, 6) : insert.slots;
          const hidden = insert.slots.length - shown.length;

          return (
            <div
              className={
                'mixer-row' +
                (insert.slots.length === 0 ? ' is-empty' : '') +
                (open ? ' is-open' : '')
              }
              key={insert.index}
            >
              <span
                className="col-num"
                style={insert.color ? { color: insert.color } : undefined}
                title={`insert ${insert.index + 1}`}
              >
                {insert.index + 1}
              </span>

              <button
                className="col-name"
                onClick={() => setExpanded(open ? null : insert.index)}
                title={insert.name || '（未命名）'}
              >
                {insert.name || '（未命名）'}
              </button>

              <span className={"col-chain" + (insert.slots.length > shown.length || open ? "" : " no-overflow")}>
                {insert.slots.length === 0 && <span className="chain-empty">—</span>}
                {shown.map((slot, position) => (
                  <span className="chain-item" key={slot.index}>
                    {position > 0 && (
                      <span className="chain-arrow" aria-hidden="true">
                        →
                      </span>
                    )}
                    <span
                      className={'chain-fx' + (slot.vst ? ' is-vst' : '')}
                      title={slot.vst?.path || slot.internalName || ''}
                    >
                      {pluginLabel(slot) || slot.internalName || '（未识别）'}
                      {slot.vst?.vendor && <em>{slot.vst.vendor}</em>}
                    </span>
                  </span>
                ))}
                {hidden > 0 && (
                  <button className="chain-more" onClick={() => setExpanded(insert.index)}>
                    +{hidden} 个
                  </button>
                )}
                {open && insert.slots.length > 6 && (
                  <button className="chain-more" onClick={() => setExpanded(null)}>
                    收起
                  </button>
                )}
              </span>

              <span className="col-count">{insert.slots.length}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
