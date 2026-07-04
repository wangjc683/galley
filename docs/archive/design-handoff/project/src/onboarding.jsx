// Onboarding — Step 2 (Health Check) inside a smaller wizard window
function Onboarding() {
  const [path, setPath] = React.useState('~/Documents/GenericAgent');
  const checks = [
    { name: '路径存在',                detail: '~/Documents/GenericAgent',  state: 'success' },
    { name: 'Python 可用',             detail: 'Python 3.11.9 (system)',    state: 'success' },
    { name: 'agentmain.py 可 import',  detail: 'GA baseline 6a3eecc · OK',  state: 'success' },
    { name: 'mykey.py 存在',           detail: '~/Documents/GenericAgent/mykey.py · 5 LLM',  state: 'success' },
    { name: '至少一个 LLM 配置可解析',  detail: 'Claude / OAI / Gemini · parse OK',          state: 'running' },
  ];

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      background: 'var(--bg-app)',
      padding: '40px 64px',
      overflow: 'auto',
    }}>
      {/* progress dots */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 36 }}>
        {['欢迎', 'Attach GA', 'Health Check', '完成'].map((s, i) => {
          const active = i === 2;
          const done = i < 2;
          return (
            <React.Fragment key={s}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 12.5,
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: active ? 500 : 400,
              }}>
                <span style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: done ? 'var(--brand)' : active ? 'var(--text-primary)' : 'transparent',
                  border: done || active ? 'none' : '1px solid var(--border-strong)',
                  color: done ? 'var(--text-primary)' : active ? 'var(--bg-app)' : 'var(--text-muted)',
                  fontSize: 11, fontWeight: 600,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>{done ? '✓' : i + 1}</span>
                {s}
              </div>
              {i < 3 && <span style={{ flex: 1, height: 1, background: 'var(--border-default)', maxWidth: 60 }} />}
            </React.Fragment>
          );
        })}
      </div>

      <div style={{ maxWidth: 580 }}>
        <h1 style={{
          fontFamily: 'var(--font-serif)',
          fontSize: 32, fontWeight: 500,
          margin: 0,
          letterSpacing: '0.005em',
          color: 'var(--text-primary)',
        }}>检查 GA 运行环境</h1>
        <p style={{
          fontFamily: 'var(--font-serif)',
          fontStyle: 'italic',
          fontSize: 15.5, color: 'var(--text-secondary)',
          marginTop: 10, marginBottom: 28,
          lineHeight: 1.6,
        }}>
          全部通过后才能进入主界面 · Workbench 不会修改你的 GA。
        </p>

        <div className="hc-card">
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            paddingBottom: 12, marginBottom: 4,
            borderBottom: '1px solid var(--border-default)',
          }}>
            <Icon name="shield-check" size={18} color="var(--text-primary)" weight="thin" />
            <div style={{ fontSize: 14, fontWeight: 500 }}>Health Check</div>
            <span style={{ marginLeft: 'auto' }} className="callout-pill pill-running">
              4 / 5 passed
            </span>
          </div>

          {checks.map((c, i) => (
            <div className="hc-row" key={c.name}>
              <span className="icon">
                {c.state === 'success' && <Icon name="check" size={16} color="var(--success)" />}
                {c.state === 'running' && (
                  <span className="spin"><Icon name="circle-notch" size={16} color="var(--brand-strong)" /></span>
                )}
                {c.state === 'failed' && <Icon name="x" size={16} color="var(--error)" />}
              </span>
              <div className="label" style={{ flex: 1 }}>
                <div>{c.name}</div>
                <div className="detail">{c.detail}</div>
              </div>
              <span className="muted" style={{ fontSize: 11 }}>{i + 1} / 5</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 24 }}>
          <button className="btn">
            <Icon name="arrow-left" size={13} />
            Back
          </button>
          <span className="muted" style={{ fontSize: 12.5, marginLeft: 8 }}>
            最后一项检查中…
          </span>
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} disabled>
            Continue
            <Icon name="arrow-right" size={13} weight="bold" />
          </button>
        </div>

        <div style={{
          marginTop: 28,
          padding: '14px 16px',
          background: 'var(--surface)',
          border: '1px solid var(--border-default)',
          borderRadius: 8,
          fontSize: 12.5,
          color: 'var(--text-secondary)',
          display: 'flex', gap: 10,
        }}>
          <Icon name="info" size={14} color="var(--text-muted)" style={{ marginTop: 2 }} />
          <div>
            跳过了 LLM session dry-run 以避免消耗 quota。第一次发送消息时如有问题会提示具体错误并给出修复路径。
          </div>
        </div>
      </div>
    </div>
  );
}

window.Onboarding = Onboarding;
