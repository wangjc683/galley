// Tool Timeline focused screen — showcases all 6 callout states
function ToolTimelineShowcase() {
  const tools = [
    {
      id: 'a1', name: 'file_read', status: 'success-historical',
      summary: '读取 desktop/src/db/migrations/ · 0 entries',
      elapsed: '120ms',
      args: { path: 'desktop/src/db/migrations/' },
    },
    {
      id: 'a2', name: 'web_scan', status: 'success-historical',
      summary: '抓取 sqlite.org/lang_createtable.html',
      elapsed: '1.4s',
      args: { url: 'https://sqlite.org/lang_createtable.html' },
    },
    {
      id: 'a3', name: 'file_patch', status: 'waiting_approval',
      summary: '新建 001_init.sql · 创建 sessions / projects 两张表',
      elapsed: '—',
      args: { path: 'desktop/src/db/migrations/001_init.sql', mode: 'create', risk: 'medium' },
    },
    {
      id: 'a4', name: 'code_run', status: 'running',
      summary: 'sqlite3 :memory: < new_schema.sql · 验证 schema 可用',
      elapsed: '2.8s',
      args: { language: 'bash', cmd: 'sqlite3 :memory: < /tmp/new_schema.sql' },
    },
    {
      id: 'a5', name: 'file_write', status: 'failed',
      summary: 'Permission denied: ~/Library/protected/output.log',
      elapsed: '40ms',
      args: { path: '~/Library/protected/output.log', mode: 'overwrite' },
      bodyRender: () => (
        <div style={{ marginTop: 6 }}>
          <div className="mono-block" style={{ background: 'rgba(177,69,69,0.04)', color: 'var(--error)', borderColor: 'rgba(177,69,69,0.18)' }}>
{`PermissionError: [Errno 13] Permission denied:
  '/Users/jc/Library/protected/output.log'
  
  at do_file_write (ga.py:1247)
  at WorkbenchHandler.dispatch (handlers.py:88)`}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn"><Icon name="arrow-clockwise" size={12} /> Retry</button>
            <button className="btn"><Icon name="caret-right" size={12} /> View raw error</button>
          </div>
        </div>
      ),
    },
    {
      id: 'a6', name: 'start_long_term_update', status: 'denied',
      summary: '用户拒绝 · agent 收到 denied 信号继续推进',
      elapsed: '—',
      args: { key: 'sqlite_schema_decision', content: '...' },
    },
  ];

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, background: 'var(--bg-app)' }}>
      {/* legend column */}
      <div style={{
        width: 260, flex: '0 0 260px',
        borderRight: '1px solid var(--border-default)',
        padding: '32px 24px',
        fontSize: 12.5,
      }}>
        <div style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 18, fontWeight: 500, marginBottom: 4,
        }}>Tool Timeline</div>
        <div style={{ color: 'var(--text-muted)', marginBottom: 24, fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 13 }}>
          6 状态映射 · DESIGN.md §4.5
        </div>

        {[
          ['running',            'brand 杏沙 · 当前展开',   'circle-notch',   'var(--brand-strong)', true],
          ['success (current)',  'brand · 当前展开',       'check-circle',   'var(--brand-strong)'],
          ['success (历史)',     '几乎不可见 · 默认折叠',   'check-circle',   'var(--text-muted)'],
          ['waiting_approval',   '深琥珀 · 强制展开',      'pause-circle',   'var(--warning)'],
          ['failed',             '深红 · 强制展开',        'x-circle',       'var(--error)'],
          ['denied',             'muted · 折叠',           'prohibit',       'var(--text-muted)'],
        ].map(([name, hint, icon, color, spin], i) => (
          <div key={name} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
            <span className={spin ? 'spin' : ''} style={{ display: 'inline-flex', flex: '0 0 16px', marginTop: 1 }}>
              <Icon name={icon} size={15} color={color} />
            </span>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text-primary)' }}>{name}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{hint}</div>
            </div>
          </div>
        ))}

        <hr style={{ border: 0, borderTop: '1px solid var(--border-default)', margin: '20px 0' }} />

        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
          数据来源
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          90% 走 <span className="mono" style={{ fontSize: 11 }}>agent._turn_end_hooks</span>，仅审批走子类化 dispatch。GA 升级安全。
        </div>
      </div>

      {/* timeline column */}
      <div style={{
        flex: 1, padding: '32px 36px 24px',
        overflow: 'auto',
        minWidth: 0,
      }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div className="msg-user">
            把 sessions 表 schema 写到 <span className="mono-inline">001_init.sql</span>，验证可用，然后写一段总结到 memory。
          </div>
          <div className="msg-agent-thinking">
            <span style={{ fontSize: 14 }}>💭</span>
            <span>先 file_read + web_scan 收集语法，写文件后用 code_run 验证。memory 写入需审批。</span>
          </div>
          {tools.map(t => <ToolCallout key={t.id} tool={t} />)}
        </div>
      </div>
    </div>
  );
}

window.ToolTimelineShowcase = ToolTimelineShowcase;
