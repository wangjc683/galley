document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('copyCookies').addEventListener('click', copyCookies);
  refreshStatus();
});

async function refreshStatus() {
  const dot = document.getElementById('dot');
  const text = document.getElementById('statusText');
  const tabs = document.getElementById('tabs');
  try {
    const resp = await chrome.runtime.sendMessage({ cmd: 'bridge_status' });
    if (resp?.ok && resp.data.connected) {
      dot.classList.add('on');
      text.textContent = '浏览器控制：已连接';
    } else {
      dot.classList.remove('on');
      text.textContent = '浏览器控制：待命（Galley 未运行）';
    }
    if (resp?.ok) tabs.textContent = `检测到 ${resp.data.tabCount} 个可操作标签页 — 插件工作正常`;
  } catch (e) {
    text.textContent = '浏览器控制：待命（Galley 未运行）';
  }
}

async function copyCookies() {
  const out = document.getElementById('out');
  out.classList.add('show');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) { out.textContent = 'No active tab'; return; }
    const resp = await chrome.runtime.sendMessage({ cmd: 'cookies', url: tab.url });
    if (!resp?.ok) { out.textContent = 'Error: ' + (resp?.error || 'unknown'); return; }
    if (!resp.data.length) { out.textContent = '(no cookies)'; return; }
    const str = resp.data.map(c => `${c.name}=${c.value}`).join('; ');
    await navigator.clipboard.writeText(str);
    out.textContent = '已复制到剪贴板\n\n' + resp.data.map(c =>
      `${c.name}=${c.value}` + (c.httpOnly ? ' [H]' : '') + (c.secure ? ' [S]' : '') + (c.partitionKey ? ' [P]' : '')
    ).join('\n');
  } catch (e) { out.textContent = 'Error: ' + e.message; }
}
