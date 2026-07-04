// Mock data for GA Workbench screens

const MOCK_SESSIONS = [
  // PINNED
  {
    id: 's-pinned-1',
    title: '调研 GA bridge IPC 协议设计',
    status: 'idle',
    summary: 'Turn 7 · 已完成 IPC 事件枚举草案',
    pinned: true,
    project: null,
    bucket: 'pinned',
    pendingApproval: 0,
    errors: 0,
  },
  // TODAY
  {
    id: 's-today-1',
    title: 'Workbench 桌面端 SQLite schema',
    status: 'running',
    summary: 'Turn 12 · 正在写 sessions 表迁移脚本',
    currentTool: 'file_patch',
    project: 'GA Workbench',
    bucket: 'today',
    pendingApproval: 1,
    errors: 0,
    isActive: true, // currently selected
  },
  {
    id: 's-today-2',
    title: '论文摘要：multi-agent retrieval',
    status: 'running',
    summary: 'Turn 4 · 抓取 arxiv 4 篇相关论文',
    currentTool: 'web_scan',
    project: null,
    bucket: 'today',
    pendingApproval: 0,
    errors: 0,
  },
  {
    id: 's-today-3',
    title: '翻译 DESIGN.md 到 EN',
    status: 'waiting_approval',
    summary: 'Turn 9 · 等待 file_write 审批',
    project: 'GA Workbench',
    bucket: 'today',
    pendingApproval: 1,
    errors: 0,
  },
  {
    id: 's-today-4',
    title: '整理周会笔记',
    status: 'completed',
    summary: 'Turn 3 · 已生成会议要点',
    project: null,
    bucket: 'today',
    pendingApproval: 0,
    errors: 0,
  },
  // THIS WEEK
  {
    id: 's-week-1',
    title: 'shadcn 组件库选型对比',
    status: 'completed',
    summary: 'Turn 6 · 推荐 shadcn + Radix',
    project: 'GA Workbench',
    bucket: 'week',
    pendingApproval: 0,
    errors: 0,
  },
  {
    id: 's-week-2',
    title: '修复 bridge 子进程 zombie',
    status: 'error',
    summary: 'Turn 5 · subprocess.kill() 抛 ProcessLookupError',
    project: 'GA Workbench',
    bucket: 'week',
    pendingApproval: 0,
    errors: 1,
  },
  {
    id: 's-week-3',
    title: '本周总结 devlog',
    status: 'completed',
    summary: 'Turn 2 · 已写入 2026-05-04-week.md',
    project: null,
    bucket: 'week',
    pendingApproval: 0,
    errors: 0,
  },
  // EARLIER
  {
    id: 's-earlier-1',
    title: 'Tauri vs Electron 调研',
    status: 'archived',
    summary: 'Turn 11 · 选定 Tauri v2',
    project: null,
    bucket: 'earlier',
    pendingApproval: 0,
    errors: 0,
  },
  {
    id: 's-earlier-2',
    title: 'Phosphor icons 集成 POC',
    status: 'archived',
    summary: 'Turn 4 · 通过',
    project: 'GA Workbench',
    bucket: 'earlier',
    pendingApproval: 0,
    errors: 0,
  },
];

// The currently selected session's full conversation
const MOCK_CONVERSATION = {
  sessionId: 's-today-1',
  title: 'Workbench 桌面端 SQLite schema',
  llm: 'Claude Sonnet 4.5',
  cwd: '~/Code/ga-workbench',
  pid: 48213,
  turns: [
    {
      role: 'user',
      content: '帮我把 sessions 表的 SQL schema 写到 desktop/src/db/migrations/001_init.sql。需要支持 PRD §8.1 里的所有字段（id, projectId, title, status, currentTool, pendingApprovalCount, errorCount, lastActivityAt, createdAt, updatedAt, pid, cwd），并加上必要的索引。',
    },
    {
      role: 'agent',
      thinking: '先 file_read 看现有 migrations 目录结构，再 file_patch 加新文件。需要审批。',
      tools: [
        {
          id: 't1', name: 'file_read', status: 'success-historical',
          summary: '读取 desktop/src/db/migrations/',
          elapsed: '120ms',
          args: { path: 'desktop/src/db/migrations/' },
        },
        {
          id: 't2', name: 'file_read', status: 'success-historical',
          summary: '查看 docs/PRD.md §8',
          elapsed: '80ms',
          args: { path: 'docs/PRD.md', start_line: 180, end_line: 230 },
        },
        {
          id: 't3', name: 'file_patch', status: 'waiting_approval',
          summary: '新建 001_init.sql · 创建 sessions / projects / tool_events / messages 四张表',
          elapsed: '—',
          riskLevel: 'medium',
          args: {
            path: 'desktop/src/db/migrations/001_init.sql',
            old_content: '',
            new_content: 'pending',
          },
        },
      ],
      finalAnswer: null, // not done yet — waiting on approval
    },
  ],
};

// The pending file_patch's diff content
const MOCK_PATCH = {
  path: 'desktop/src/db/migrations/001_init.sql',
  oldLines: [
    { n: null, text: '', kind: 'empty' },
    { n: null, text: '', kind: 'empty' },
    { n: null, text: '', kind: 'empty' },
    { n: null, text: '', kind: 'empty' },
    { n: null, text: '', kind: 'empty' },
    { n: null, text: '', kind: 'empty' },
    { n: null, text: '', kind: 'empty' },
    { n: null, text: '', kind: 'empty' },
    { n: null, text: '', kind: 'empty' },
    { n: null, text: '', kind: 'empty' },
    { n: null, text: '', kind: 'empty' },
    { n: null, text: '', kind: 'empty' },
    { n: null, text: '', kind: 'empty' },
    { n: null, text: '', kind: 'empty' },
    { n: null, text: '', kind: 'empty' },
    { n: null, text: '', kind: 'empty' },
    { n: null, text: '', kind: 'empty' },
    { n: null, text: '', kind: 'empty' },
  ],
  newLines: [
    { n: 1,  text: '-- 001_init.sql · GA Workbench v0.1', kind: 'add' },
    { n: 2,  text: '-- Created by GA agent · 2026-05-08', kind: 'add' },
    { n: 3,  text: '', kind: 'add' },
    { n: 4,  text: 'CREATE TABLE projects (', kind: 'add' },
    { n: 5,  text: '  id          TEXT PRIMARY KEY,', kind: 'add' },
    { n: 6,  text: '  name        TEXT NOT NULL,', kind: 'add' },
    { n: 7,  text: '  root_path   TEXT,', kind: 'add' },
    { n: 8,  text: '  created_at  TEXT NOT NULL,', kind: 'add' },
    { n: 9,  text: '  updated_at  TEXT NOT NULL', kind: 'add' },
    { n: 10, text: ');', kind: 'add' },
    { n: 11, text: '', kind: 'add' },
    { n: 12, text: 'CREATE TABLE sessions (', kind: 'add' },
    { n: 13, text: '  id                TEXT PRIMARY KEY,', kind: 'add' },
    { n: 14, text: '  project_id        TEXT REFERENCES projects(id) ON DELETE SET NULL,', kind: 'add' },
    { n: 15, text: '  title             TEXT NOT NULL,', kind: 'add' },
    { n: 16, text: '  status            TEXT NOT NULL CHECK (status IN', kind: 'add' },
    { n: 17, text: "    ('idle','running','waiting_approval','error','completed','archived')),", kind: 'add' },
    { n: 18, text: '  last_activity_at  TEXT NOT NULL', kind: 'add' },
  ],
};

window.MOCK_SESSIONS = MOCK_SESSIONS;
window.MOCK_CONVERSATION = MOCK_CONVERSATION;
window.MOCK_PATCH = MOCK_PATCH;
