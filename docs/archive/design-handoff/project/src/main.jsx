// Main view — full 3-pane: sidebar + conversation + inspector
function MainView() {
  const [sessions, setSessions] = React.useState(window.MOCK_SESSIONS);
  const [activeId, setActiveId] = React.useState('s-today-1');
  const [approvalDecision, setApprovalDecision] = React.useState(null);
  const [inspectorTab, setInspectorTab] = React.useState('details');

  const active = sessions.find(s => s.id === activeId) || sessions[0];
  const conv = window.MOCK_CONVERSATION;

  const handleApprove = (decision) => {
    setApprovalDecision(decision);
    // also clear the pending approval count on the session
    setSessions(ss => ss.map(s => s.id === activeId ? { ...s, pendingApproval: 0, status: decision === 'deny' ? 'running' : 'running' } : s));
  };

  const renderToolBody = (t) => {
    if (t.name === 'file_patch' && t.status === 'waiting_approval' && approvalDecision === null) {
      return ({ approvalState, onApprove }) => (
        <FilePatchApproval patch={window.MOCK_PATCH} approvalState={approvalDecision} onApprove={handleApprove} />
      );
    }
    if (t.name === 'file_patch' && approvalDecision !== null) {
      return ({ approvalState, onApprove }) => (
        <FilePatchApproval patch={window.MOCK_PATCH} approvalState={approvalDecision} onApprove={handleApprove} />
      );
    }
    return null;
  };

  const userTurn = conv.turns.find(t => t.role === 'user') || {};
  const agentTurn = conv.turns.find(t => t.role === 'agent') || { tools: [] };

  // Build adjusted tool list reflecting approval decision
  const buildTools = () => {
    return (agentTurn.tools || []).map(t => {
      if (t.id === 't3') {
        let status = t.status;
        let summary = t.summary;
        if (approvalDecision === 'allow_once' || approvalDecision === 'always_project' || approvalDecision === 'always_global') {
          status = 'running';
          summary = '正在写入 desktop/src/db/migrations/001_init.sql …';
        } else if (approvalDecision === 'deny') {
          status = 'denied';
          summary = '已拒绝。agent 收到 denied 信号，将在下一 turn 调整方案。';
        }
        return { ...t, status, summary, bodyRender: renderToolBody(t) };
      }
      return t;
    });
  };

  const tools = buildTools();
  const showFinalAnswer = approvalDecision !== null && approvalDecision !== 'deny';
  const stillWaiting = approvalDecision === null;

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <Sidebar sessions={sessions} activeId={activeId} onSelect={setActiveId} />

      {/* Conversation column */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        background: 'var(--bg-app)',
        minWidth: 0,
      }}>
        {/* Session title bar */}
        <div style={{
          height: 44, padding: '0 24px',
          display: 'flex', alignItems: 'center', gap: 12,
          borderBottom: '1px solid var(--border-default)',
          background: 'var(--bg-app)',
        }}>
          <StatusIcon status={active.status} size={14} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
            {active.title}
          </div>
          {active.pendingApproval > 0 && stillWaiting && (
            <span className="callout-pill pill-waiting">{active.pendingApproval} 待审批</span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 11.5 }}>
              <span className="mono">PID {conv.pid}</span> · cwd <span className="mono">{conv.cwd}</span>
            </span>
            <span style={{ width: 1, height: 16, background: 'var(--border-default)' }} />
            <span className="quick-action" style={{ margin: 0, padding: '4px 8px' }}>
              <Icon name="dots-three" size={14} />
            </span>
          </div>
        </div>

        {/* Conversation scroll */}
        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '24px 32px 16px',
          maxWidth: '100%',
        }}>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            {/* user message */}
            <div className="msg-user">{userTurn.content}</div>

            {/* thinking summary */}
            <div className="msg-agent-thinking">
              <span style={{ fontSize: 14 }}>💭</span>
              <span>{agentTurn.thinking}</span>
            </div>

            {/* tools */}
            {tools.map((t, i) => (
              <ToolCallout
                key={t.id}
                tool={t}
                approvalState={approvalDecision}
                onApprove={handleApprove}
              />
            ))}

            {/* final answer block (only after approval) */}
            {showFinalAnswer && (
              <>
                <hr className="hr-strong" />
                <div className="msg-agent">
                  <p>已为你生成 <code>desktop/src/db/migrations/001_init.sql</code>，包含 <code>projects</code> / <code>sessions</code> 两张表的初始 schema。</p>
                  <p>下一步建议：</p>
                  <p style={{ paddingLeft: 16 }}>
                    · 跑 <code>npm run db:migrate</code> 验证 schema 可用<br />
                    · 之后再加 <code>tool_events</code> 与 <code>messages</code> 两张表（已为你预留 002 / 003 文件名）
                  </p>
                </div>
              </>
            )}

            {/* still waiting state — gentle hint */}
            {stillWaiting && (
              <div style={{
                marginTop: 16,
                fontSize: 13, color: 'var(--text-muted)',
                fontStyle: 'italic',
                fontFamily: 'var(--font-serif)',
                paddingLeft: 4,
              }}>
                等待审批中 · agent 已暂停在 file_patch dispatch
              </div>
            )}
          </div>
        </div>

        {/* Approval dock + Composer */}
        <div style={{
          padding: '0 32px 18px',
          background: 'var(--bg-app)',
        }}>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            {stillWaiting && (
              <div className="approval-dock">
                <span className="approval-dock-count">
                  <Icon name="pause" size={14} color="var(--warning)" />
                  1 pending approval
                </span>
                <span style={{ color: 'var(--text-secondary)', fontSize: 12.5 }}>
                  Next: <span className="mono-inline">file_patch</span> on
                  <span className="mono-inline" style={{ marginLeft: 4 }}>001_init.sql</span>
                </span>
                <button className="btn" style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 12.5 }}>
                  Advance
                  <Icon name="arrow-right" size={12} />
                </button>
              </div>
            )}
            <Composer
              llm={conv.llm}
              placeholder="继续这个对话…"
              stopMode={stillWaiting}
            />
            <div style={{
              fontSize: 11, color: 'var(--text-muted)', marginTop: 6,
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span>Enter 发送 · Shift+Enter 换行</span>
              <span>切换 LLM 不会丢失上下文</span>
            </div>
          </div>
        </div>
      </div>

      {/* Inspector */}
      <Inspector tab={inspectorTab} setTab={setInspectorTab} session={active} />
    </div>
  );
}

function Inspector({ tab, setTab, session }) {
  return (
    <div className="inspector">
      <div className="inspector-tabs">
        {['details', 'approvals', 'runtime'].map(t => (
          <div
            key={t}
            className={'inspector-tab' + (tab === t ? ' is-active' : '')}
            onClick={() => setTab(t)}
          >
            {t === 'details' ? 'Details' : t === 'approvals' ? 'Approvals' : 'Runtime'}
          </div>
        ))}
      </div>
      <div className="inspector-body">
        {tab === 'details' && <InspectorDetails />}
        {tab === 'approvals' && <InspectorApprovals />}
        {tab === 'runtime' && <InspectorRuntime />}
      </div>
    </div>
  );
}

function InspectorDetails() {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
        Selected · file_patch
      </div>
      <dl style={{ margin: 0 }}>
        <div className="inspector-row"><dt>tool</dt><dd>file_patch</dd></div>
        <div className="inspector-row"><dt>turn</dt><dd>1 / 1</dd></div>
        <div className="inspector-row"><dt>status</dt><dd>waiting_approval</dd></div>
        <div className="inspector-row"><dt>risk</dt><dd>medium</dd></div>
        <div className="inspector-row"><dt>approval_id</dt><dd>apr_8f2c…</dd></div>
      </dl>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '20px 0 8px' }}>
        Args
      </div>
      <div className="mono-block" style={{ fontSize: 11.5 }}>
{`{
  "path": "desktop/src/db/
            migrations/001_init.sql",
  "old_content": "",
  "new_content": "<see diff>"
}`}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '20px 0 8px' }}>
        Why approval?
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
        file_patch 在默认审批列表里。新建文件路径对当前 cwd 之外没有写访问。GA 已通过 dispatch generator yield 等待你的决策。
      </div>
    </div>
  );
}

function InspectorApprovals() {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>
        Pending · 1
      </div>
      <div style={{ padding: 10, background: 'var(--brand-soft)', borderRadius: 8, fontSize: 12.5 }}>
        <div style={{ fontWeight: 500 }}>file_patch · 001_init.sql</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 11.5, marginTop: 4 }}>等待中 · 14 秒</div>
        <div style={{ color: 'var(--brand-strong)', fontSize: 11.5, marginTop: 6, cursor: 'pointer' }}>
          Jump to in conversation →
        </div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', margin: '20px 0 10px' }}>
        Earlier this session · 2
      </div>
      {[
        { tool: 'file_read', state: 'auto-allowed', when: '2 min ago' },
        { tool: 'file_read', state: 'auto-allowed', when: '2 min ago' },
      ].map((a, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: 12, borderBottom: '1px solid var(--border-default)' }}>
          <span className="mono">{a.tool}</span>
          <span className="muted">{a.when} · {a.state}</span>
        </div>
      ))}
    </div>
  );
}

function InspectorRuntime() {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>
        Health Check · all passed
      </div>
      {[
        ['GA path', '~/Documents/GenericAgent', true],
        ['Python', '3.11.9 (system)', true],
        ['agentmain.py', '可 import', true],
        ['mykey.py', '5 LLM 配置', true],
        ['LLM session', 'Claude Sonnet 4.5', true],
      ].map(([k, v, ok], i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
          <Icon name="check" size={14} color="var(--success)" />
          <span style={{ fontSize: 12.5, flex: 1 }}>{k}</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{v}</span>
        </div>
      ))}
      <hr style={{ border: 0, borderTop: '1px solid var(--border-default)', margin: '14px 0' }} />
      <dl style={{ margin: 0 }}>
        <div className="inspector-row"><dt>Bridge PID</dt><dd>48213</dd></div>
        <div className="inspector-row"><dt>cwd</dt><dd>~/Code/ga-workbench</dd></div>
        <div className="inspector-row"><dt>LLM</dt><dd>Claude Sonnet 4.5</dd></div>
        <div className="inspector-row"><dt>GA baseline</dt><dd>6a3eecc</dd></div>
        <div className="inspector-row"><dt>Workbench</dt><dd>v0.1.0</dd></div>
      </dl>
      <button className="btn" style={{ marginTop: 14, width: '100%', justifyContent: 'center' }}>
        <Icon name="arrows-clockwise" size={13} />
        Re-run health check
      </button>
    </div>
  );
}

window.MainView = MainView;
