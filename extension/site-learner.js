// Runs inside the SharePoint pages that Teams shows in its "Shared" tab and just tells the extension
// which class site it is, so the site is remembered. It reads and changes nothing on the page.
(() => {
  const m = location.pathname.match(/^\/sites\/msteams_[^/]+/i);
  if (!m) return;
  try { chrome.runtime.sendMessage({ cmd: 'learnSite', url: location.origin + m[0] }); } catch (e) {}
})();
