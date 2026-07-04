// Lightweight icon helpers + mac window chrome
// Uses Phosphor icons via web font (loaded in HTML head)

function Icon({ name, size = 16, weight = 'thin', color, style = {} }) {
  const cls = `ph-${weight} ph-${name}`;
  return (
    <i
      className={cls}
      style={{ fontSize: size, color: color || 'currentColor', lineHeight: 1, ...style }}
    />
  );
}

function MacChrome({ width, height, title = 'GA Workbench', children, showTraffic = true, titleStyle = {} }) {
  return (
    <div className="macwin" style={{ width, height }}>
      <div className="macwin-titlebar">
        {showTraffic && (
          <div className="macwin-traffic">
            <span className="macwin-dot" style={{ background: '#FF5F57' }} />
            <span className="macwin-dot" style={{ background: '#FEBC2E' }} />
            <span className="macwin-dot" style={{ background: '#28C840' }} />
          </div>
        )}
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500,
          ...titleStyle,
        }}>
          {title}
        </div>
        <div style={{ width: 52 }} />
      </div>
      <div className="macwin-body">{children}</div>
    </div>
  );
}

function StatusIcon({ status, size = 16 }) {
  // status: idle | connecting | running | waiting_approval | error | completed | archived
  const map = {
    idle:             { name: 'circle',        color: 'var(--text-muted)' },
    connecting:       { name: 'circle-notch',  color: 'var(--text-muted)', spin: true },
    running:          { name: 'circle-notch',  color: 'var(--brand-strong)', spin: true },
    waiting_approval: { name: 'pause-circle',  color: 'var(--warning)' },
    error:            { name: 'x-circle',      color: 'var(--error)' },
    completed:        { name: 'check-circle',  color: 'var(--brand-strong)' },
    archived:         { name: 'archive',       color: 'var(--text-muted)' },
  };
  const cfg = map[status] || map.idle;
  return (
    <span className={cfg.spin ? 'spin' : ''} style={{ display: 'inline-flex' }}>
      <Icon name={cfg.name} size={size} color={cfg.color} />
    </span>
  );
}

Object.assign(window, { Icon, MacChrome, StatusIcon });
