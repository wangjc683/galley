// Tool callout — used in main + timeline screens
function ToolCallout({ tool, defaultOpen, onApprove, approvalState, dense = false }) {
  const isWaiting = tool.status === 'waiting_approval';
  const isFailed = tool.status === 'failed';
  const forced = isWaiting || isFailed;
  const initialOpen = forced || defaultOpen ||
    tool.status === 'running' || tool.status === 'success-current';
  const [open, setOpen] = React.useState(initialOpen);

  const statusToClass = {
    'running': 'running',
    'success-current': 'success-current',
    'success-historical': 'success-historical',
    'waiting_approval': 'waiting-approval',
    'failed': 'failed',
    'denied': 'denied',
  };
  const cls = `callout ${statusToClass[tool.status] || ''}`;

  const StatusBit = () => {
    if (tool.status === 'running') return (
      <span className="spin"><Icon name="circle-notch" size={16} color="var(--brand-strong)" /></span>
    );
    if (tool.status === 'success-current' || tool.status === 'success-historical')
      return <Icon name="check-circle" size={16} color={tool.status === 'success-current' ? 'var(--brand-strong)' : 'var(--text-muted)'} />;
    if (tool.status === 'waiting_approval')
      return <Icon name="pause-circle" size={16} color="var(--warning)" />;
    if (tool.status === 'failed')
      return <Icon name="x-circle" size={16} color="var(--error)" />;
    if (tool.status === 'denied')
      return <Icon name="prohibit" size={16} color="var(--text-muted)" />;
    return <Icon name="circle" size={16} color="var(--text-muted)" />;
  };

  const PillStatus = () => {
    if (tool.status === 'running')         return <span className="callout-pill pill-running">running</span>;
    if (tool.status === 'success-current' || tool.status === 'success-historical')
                                            return <span className="callout-pill pill-success">success</span>;
    if (tool.status === 'waiting_approval') return <span className="callout-pill pill-waiting">awaiting approval</span>;
    if (tool.status === 'failed')           return <span className="callout-pill pill-failed">failed</span>;
    if (tool.status === 'denied')           return <span className="callout-pill pill-denied">denied</span>;
    return null;
  };

  return (
    <div className={cls}>
      <div className="callout-head" onClick={() => !forced && setOpen(o => !o)}>
        <span className="callout-icon"><StatusBit /></span>
        <span className="callout-name">{tool.name}</span>
        <span className="callout-meta">
          <PillStatus />
          {tool.elapsed && <span>{tool.elapsed}</span>}
          {!forced && (
            <Icon
              name="caret-down"
              size={12}
              color="var(--text-muted)"
              style={{ transition: 'transform 0.18s', transform: open ? 'rotate(180deg)' : 'none' }}
            />
          )}
        </span>
      </div>
      {tool.summary && !open && (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6, marginLeft: 26 }}>
          {tool.summary}
        </div>
      )}
      {open && (
        <div className="callout-body fade-in">
          {tool.summary && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>
              {tool.summary}
            </div>
          )}
          {tool.argsRender && tool.argsRender()}
          {tool.args && !tool.argsRender && (
            <div className="mono-block">
              {Object.entries(tool.args).map(([k, v]) => (
                <div key={k}>
                  <span style={{ color: 'var(--text-muted)' }}>{k}: </span>
                  <span>{typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v)}</span>
                </div>
              ))}
            </div>
          )}
          {tool.bodyRender && tool.bodyRender({ approvalState, onApprove })}
        </div>
      )}
    </div>
  );
}

window.ToolCallout = ToolCallout;
