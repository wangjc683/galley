// Empty state — composer hero
function EmptyState() {
  const [v, setV] = React.useState('');
  const sessions = window.MOCK_SESSIONS;

  const Tile = ({ icon, label }) => (
    <div className="chip">
      <Icon name={icon} size={14} color="var(--text-secondary)" />
      <span>{label}</span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      {/* minimal sidebar */}
      <div className="sidebar" style={{ width: 240, flex: '0 0 240px' }}>
        <div style={{ padding: '14px 16px 8px', borderBottom: '1px solid var(--border-default)' }}>
          <div style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 16, fontWeight: 500,
            color: 'var(--text-primary)',
          }}>GA Workbench</div>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-secondary)' }}>
            <span className="dot healthy" />
            <span>Runtime · healthy</span>
          </div>
        </div>
        <div style={{ padding: '8px 0' }}>
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
        <div style={{ flex: 1, padding: '24px 20px', color: 'var(--text-muted)', fontSize: 12.5, fontStyle: 'italic', fontFamily: 'var(--font-serif)' }}>
          这里会出现你的 sessions。
        </div>
      </div>

      {/* hero composer */}
      <div style={{
        flex: 1,
        background: 'var(--bg-app)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '48px 64px',
      }}>
        <div style={{ width: '100%', maxWidth: 560 }}>
          <div style={{
            fontFamily: 'var(--font-serif)',
            fontStyle: 'italic',
            fontSize: 22,
            color: 'var(--text-secondary)',
            textAlign: 'center',
            marginBottom: 24,
            letterSpacing: '0.005em',
          }}>
            你想做什么？
          </div>

          <Composer
            value={v}
            onChange={setV}
            llm="Claude Sonnet 4.5"
            placeholder="问点什么，或粘贴一段文字 / 文件路径 …"
            autoFocus={false}
          />

          <div style={{
            display: 'flex', gap: 10, flexWrap: 'wrap',
            justifyContent: 'center',
            marginTop: 22,
          }}>
            <Tile icon="translate" label="翻译" />
            <Tile icon="note-pencil" label="整理会议笔记" />
            <Tile icon="book-open-text" label="论文查询" />
            <Tile icon="terminal-window" label="写脚本" />
          </div>

          <div style={{
            marginTop: 40, textAlign: 'center',
            fontSize: 12, color: 'var(--text-muted)',
          }}>
            ⌘K 打开命令面板 · ⌘N 新建对话 · ⌘\ 折叠 sidebar
          </div>
        </div>
      </div>
    </div>
  );
}

window.EmptyState = EmptyState;
