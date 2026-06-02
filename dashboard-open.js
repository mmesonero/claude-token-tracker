// Opens the bundled usage.html in a new tab. Externalized to satisfy MV3 CSP.
document.getElementById('openUsage').addEventListener('click', () => {
  const url = chrome.runtime.getURL('usage.html');
  if (chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank');
  }
});
