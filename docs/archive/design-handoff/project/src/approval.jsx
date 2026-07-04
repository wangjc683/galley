// Approval Card focused screen — file_patch with split diff, expanded
function ApprovalCardShowcase() {
  const [decision, setDecision] = React.useState(null);

  const tool = {
    id: 'apr-demo', name: 'file_patch',
    status: decision === null ? 'waiting_approval' : decision === 'deny' ? 'denied' : 'running',
    summary: decision === null
      ? '新建 desktop/src/db/migrations/001_init.sql'
      : decision === 'deny'
        ? '已拒绝 · agent 收到 denied 信号'
        : '正在写入文件…',
    elapsed: decision === null ? 'pending · 14s' : '—',
    bodyRender: () => (
      <FilePatchApproval
        patch={window.MOCK_PATCH}
        approvalState={decision}
        onApprove={setDecision}
      />
    ),
  };

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, background: 'var(--bg-app)' }}>
      {/* annotation column */}
      <div style={{
        width: 280, flex: '0 0 280px',
        borderRight: '1px solid var(--border-default)',
        padding: '32px 24px',
        fontSize: 12.5,
      }}>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 500, marginBottom: 4 }}>
          Approval Card
        </div>
        <div style={{ color: 'var(--text-muted)', marginBottom: 24, fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 13 }}>
          file_patch · split diff
        </div>

        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>
          Card 必显字段
        </div>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <li>· risk pill（high / medium / low）</li>
          <li>· 动作说明（人话一行）</li>
          <li>· 目标文件路径</li>
          <li>· split diff（@pierre/diffs）</li>
          <li>· 为什么需要审批</li>
          <li>· 4 个决策按钮</li>
        </ul>

        <hr style={{ border: 0, borderTop: '1px solid var(--border-default)', margin: '20px 0' }} />

        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>
          Generator 暂停
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <span className="mono" style={{ fontSize: 11 }}>WorkbenchHandler.dispatch</span> yield 后阻塞，收到决策才恢复。GA agent_runner_loop 不需要修改。
        </div>

        <hr style={{ border: 0, borderTop: '1px solid var(--border-default)', margin: '20px 0' }} />

        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          点按钮试试 · 决策有反馈，可点 reset 重置
        </div>
        <button
          className="btn"
          style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
          onClick={() => setDecision(null)}
          disabled={decision === null}
        >
          <Icon name="arrow-counter-clockwise" size={12} />
          Reset 决策
        </button>
      </div>

      {/* main column with the card */}
      <div style={{ flex: 1, padding: '32px 36px', overflow: 'auto', minWidth: 0 }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <div className="msg-user">
            把 sessions / projects 两张表的初始 schema 加到 <span className="mono-inline">001_init.sql</span>。
          </div>
          <div className="msg-agent-thinking">
            <span style={{ fontSize: 14 }}>💭</span>
            <span>新建 sql 文件 · 涉及写盘，需审批后再 dispatch。</span>
          </div>

          {/* approval dock */}
          {decision === null && (
            <div className="approval-dock">
              <span className="approval-dock-count">
                <Icon name="pause" size={14} color="var(--warning)" />
                1 pending approval
              </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>
                Next: <span className="mono-inline">file_patch</span> · medium risk
              </span>
              <button className="btn" style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 12.5 }}>
                Advance
                <Icon name="arrow-right" size={12} />
              </button>
            </div>
          )}

          <ToolCallout tool={tool} />

          {decision !== null && decision !== 'deny' && (
            <>
              <hr className="hr-strong" />
              <div className="msg-agent">
                <p>已写入 <code>desktop/src/db/migrations/001_init.sql</code>，包含 <code>projects</code> / <code>sessions</code> 两张表与基础约束。</p>
              </div>
            </>
          )}

          {decision === 'deny' && (
            <>
              <hr className="hr-strong" />
              <div className="msg-agent">
                <p>收到 denied 信号。已切换方案 — 把 schema 输出为 markdown 放在回复里，由你手动落盘。</p>
                <div className="mono-block" style={{ marginTop: 10 }}>
{`CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ...
);`}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

window.ApprovalCardShowcase = ApprovalCardShowcase;
