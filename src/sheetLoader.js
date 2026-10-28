// Runs on the dashboard page before it draws anything. Reads the Google Sheet through /api/sheet and, if that
// works, leaves the datasets in window.__SHEET__ for the page to use. If anything goes wrong the page carries
// on with the data that was built into it, and window.__SHEET_ERROR__ says why.
//
// The request is synchronous on purpose: the page below draws from these datasets as it loads, and this is
// the one way to have them ready without restructuring it. It is one same-origin request.
(function () {
  window.__SHEET__ = null;
  window.__SHEET_ERROR__ = null;
  try {
    if (!/^https?:$/.test(location.protocol)) return;                          // opened from a file: nothing to read
    if (/[?&]data=embedded\b/.test(location.search)) return;                  // escape hatch: show the built-in data
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/sheet', false);
    xhr.send();
    if (xhr.status !== 200) throw new Error('/api/sheet answered ' + xhr.status);
    var tabs = SheetAdapter.parseSheetResponse(JSON.parse(xhr.responseText));
    if (!SheetAdapter.isUsable(tabs)) throw new Error('the sheet is missing a tab the page needs');
    var today = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });
    window.__SHEET__ = SheetAdapter.buildDatasets(tabs, today);
  } catch (err) {
    window.__SHEET__ = null;
    window.__SHEET_ERROR__ = String((err && err.message) || err);
    if (window.console) console.warn('Showing the data built into this page: ' + window.__SHEET_ERROR__);
  }
})();
