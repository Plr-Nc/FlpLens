import type { Project } from '../flp/project.ts';
import { pluginLabel } from '../flp/project.ts';

export function Mixer(props: { project: Project }) {
  // Event 98 fires for every slot of every insert, loaded or not; only slots
  // that actually name something are interesting in a read-only view.
  const inserts = props.project.mixer
    .map((insert) => ({
      ...insert,
      slots: insert.slots.filter((slot) => slot.internalName || slot.name || slot.vst),
    }))
    .filter((insert) => insert.slots.length > 0 || insert.name !== '');

  if (inserts.length === 0) {
    return <div className="empty">这个工程没有可显示的混音台信息</div>;
  }

  const total = inserts.reduce((sum, insert) => sum + insert.slots.length, 0);

  return (
    <div className="panel">
      <div className="section-title">
        混音台 · {inserts.length} 个 insert · {total} 个已加载效果
      </div>
      <div className="mixer-grid">
        {inserts.map((insert) => (
          <div className="mixer-strip" key={insert.index}>
            <div className="mixer-head" style={insert.color ? { borderLeftColor: insert.color } : undefined}>
              <span className="num">#{insert.index + 1}</span>
              <span className="name">{insert.name || '（未命名）'}</span>
            </div>
            <div className="mixer-slots">
              {insert.slots.length === 0 && <div className="slot empty">空</div>}
              {insert.slots.map((slot) => (
                <div className="slot" key={slot.index} title={slot.vst?.path || slot.internalName}>
                  <span className="idx">{slot.index}</span>
                  <span className="fx">
                    {pluginLabel(slot) || slot.internalName || '（未识别）'}
                    {slot.vst?.vendor && <em>{slot.vst.vendor}</em>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
