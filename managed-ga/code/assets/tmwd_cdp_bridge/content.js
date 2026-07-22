;(function(){ if (/streamlit/i.test(document.title)) return;

if (window.self === window.top && /^https?:/.test(location.href)) {
  try {
    chrome.runtime.sendMessage({
      cmd: 'wake',
      url: location.href,
      title: document.title
    }).catch(() => {});
  } catch (_) {}
}

// Remove meta CSP tags
document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach(e => e.remove());

})();
