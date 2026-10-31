// ISOLATED: this temporary diagnostic receiver never reads page globals.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || message?.namespace !== "rename-studio.browser.v1" ||
      message.type !== "debug-result") return;
  console.info(chrome.i18n.getMessage(message.summary.ok ? "debugSuccess" : "debugFailure"),
    message.summary);
});
