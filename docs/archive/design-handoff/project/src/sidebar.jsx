// Sidebar — shared by main / empty screens
function Sidebar({ sessions, activeId, onSelect, compact = false }) {
  const buckets = {
    pinned:  sessions.filter(s => s.bucket === 'pinned'),
    today:   sessions.filter(s => s.bucket === 'today'),
    week:    sessions.filter(s => s.bucket === 'week'),
    earlier: sessions.filter(s => s.bucket === 'earlier'),
  };

  const Row = ({ s }) => {
    const active = s.id === activeId;
    return (
      <div
        className={'sidebar-row' + (active ? ' is-active' : '')}
        onClick={() => onSelect && onSelect(s.id)}
      >
        <div className="sidebar-row-icon">
          <StatusIcon status={s.status} size={14} />
        </div>
        <div className="sidebar-row-body">
          <div className="sidebar-row-title">{s.title}</div>
          <div className="sidebar-row-summary">{s.summary}</div>
          {(s.pendingApproval > 0 || s.errors > 0) && (
            <div className="sidebar-row-badges">
              {s.pendingApproval > 0 && (
                <span className="sidebar-row-badge amber">
                  <Icon name="pause" size={10} weight="bold" />
                  {s.pendingApproval} 待审批
                </span>
              )}
              {s.errors > 0 && (
                <span className="sidebar-row-badge red">
                  <Icon name="warning-circle" size={10} weight="bold" />
                  {s.errors} 错误
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const SectionLabel = ({ children }) => (
    <div className="sidebar-section-label">{children}</div>
  );

  return (
    <div className="sidebar">
      {/* runtime header */}
      <div style={{ padding: '14px 16px 8px', borderBottom: '1px solid var(--border-default)' }}>
        <div style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 16, fontWeight: 500,
          color: 'var(--text-primary)',
          letterSpacing: '0.01em',
        }}>GA Workbench</div>
        <div style={{
          marginTop: 6,
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 11.5, color: 'var(--text-secondary)',
        }}>
          <span className="dot healthy" />
          <span>Runtime · healthy</span>
          <Icon name="caret-down" size={10} color="var(--text-muted)" style={{ marginLeft: 'auto' }} />
        </div>
      </div>

      {/* quick actions */}
      <div style={{ padding: '6px 0', borderBottom: '1px solid var(--border-default)' }}>
        <div className="quick-action">
          <Icon name="plus" size={14} color="var(--text-secondary)" />
          <span>New Chat</span>
          <span className="kbd">⌘N</span>
        </div>
        <div className="quick-action">
          <Icon name="magnifying-glass" size={14} color="var(--text-secondary)" />
          <span>Search</span>
          <span className="kbd">⌘K</span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
        {buckets.pinned.length > 0 && <>
          <SectionLabel>Pinned</SectionLabel>
          {buckets.pinned.map(s => <Row key={s.id} s={s} />)}
        </>}
        {buckets.today.length > 0 && <>
          <SectionLabel>Today</SectionLabel>
          {buckets.today.map(s => <Row key={s.id} s={s} />)}
        </>}
        {buckets.week.length > 0 && <>
          <SectionLabel>This week</SectionLabel>
          {buckets.week.map(s => <Row key={s.id} s={s} />)}
        </>}
        {buckets.earlier.length > 0 && <>
          <SectionLabel>Earlier</SectionLabel>
          {buckets.earlier.map(s => <Row key={s.id} s={s} />)}
        </>}

        <SectionLabel>Projects</SectionLabel>
        <div className="quick-action" style={{ paddingLeft: 14 }}>
          <Icon name="folder" size={14} color="var(--text-secondary)" />
          <span>GA Workbench</span>
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>4</span>
        </div>
        <div className="quick-action" style={{ paddingLeft: 14 }}>
          <Icon name="folder" size={14} color="var(--text-muted)" />
          <span style={{ color: 'var(--text-secondary)' }}>论文阅读</span>
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>2</span>
        </div>
      </div>

      <div style={{
        borderTop: '1px solid var(--border-default)',
        padding: '8px 14px',
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 11.5, color: 'var(--text-muted)',
      }}>
        <Icon name="trash" size={12} />
        <span>Trash</span>
      </div>
    </div>
  );
}

window.Sidebar = Sidebar;
