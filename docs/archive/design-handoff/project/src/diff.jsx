// Diff component — split view (left old, right new)
function SplitDiff({ patch }) {
  const { path, oldLines, newLines } = patch;
  const adds = newLines.filter(l => l.kind === 'add').length;
  const dels = oldLines.filter(l => l.kind === 'del').length;
  const newCount = newLines.filter(l => l.kind === 'add').length;
  const delCount = oldLines.filter(l => l.kind === 'empty').length === oldLines.length ? 0 : dels;
  const len = Math.max(oldLines.length, newLines.length);

  const Side = ({ lines, side }) => (
    <div className="diff-side">
      {Array.from({ length: len }).map((_, i) => {
        const l = lines[i] || { n: null, text: '', kind: 'empty' };
        return (
          <div key={i} className={`diff-line ${l.kind}`}>
            <span className="diff-num">{l.n ?? ''}</span>
            <span className="diff-text">{l.text}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="diff">
      <div className="diff-head">
        <span className="path">{path}</span>
        <span className="stat">
          <span className="add">+{adds} lines</span>
          <span className="del">−{delCount} lines</span>
          <span style={{ color: 'var(--text-muted)' }}>· new file</span>
        </span>
      </div>
      <div className="diff-grid">
        <Side lines={patch.oldLines} side="old" />
        <Side lines={patch.newLines} side="new" />
      </div>
    </div>
  );
}

// Approval form rendered inside a waiting_approval callout's body
function FilePatchApproval({ patch, approvalState, onApprove }) {
  const decided = approvalState && approvalState !== null;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <span className="callout-pill pill-risk-medium">medium risk</span>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Patch file at <span className="mono-inline">{patch.path}</span>
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
        <Icon name="info" size={12} color="var(--text-muted)" style={{ marginRight: 6 }} />
        file_patch 会写入文件。审批后 GA 才会实际执行 dispatch。
      </div>
      <SplitDiff patch={patch} />
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        {!decided && <>
          <button className="btn btn-primary" onClick={() => onApprove('allow_once')}>
            <Icon name="check" size={13} weight="bold" />
            Allow once
          </button>
          <button className="btn btn-ghost-danger" onClick={() => onApprove('deny')}>
            <Icon name="x" size={13} weight="bold" />
            Deny
          </button>
          <button className="btn btn-ghost-brand" onClick={() => onApprove('always_project')}>
            <Icon name="folder-simple" size={13} />
            Always allow in this Project
          </button>
          <button className="btn btn-ghost-brand" onClick={() => onApprove('always_global')}>
            <Icon name="globe" size={13} />
            Always allow globally
          </button>
        </>}
        {decided && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '8px 14px', borderRadius: 8,
            background: approvalState === 'deny' ? 'rgba(177,69,69,0.06)' : 'var(--brand-soft)',
            color: approvalState === 'deny' ? 'var(--error)' : 'var(--brand-strong)',
            fontSize: 13, fontWeight: 500,
          }}>
            <Icon name={approvalState === 'deny' ? 'prohibit' : 'check-circle'} size={14} />
            {approvalState === 'allow_once' && 'Allowed · 已通过本次执行'}
            {approvalState === 'deny' && 'Denied · agent 将收到拒绝信号'}
            {approvalState === 'always_project' && '已加入 GA Workbench Project 白名单'}
            {approvalState === 'always_global' && '已加入全局白名单'}
          </div>
        )}
      </div>
    </div>
  );
}

window.SplitDiff = SplitDiff;
window.FilePatchApproval = FilePatchApproval;
