// Chrome serializes this function when injecting it into the page.
export function extractGoogleDriveFolder(requestId) {
  const url = new URL(location.href);
  const root = /^\/drive\/u\/\d+\/my-drive\/?$/.test(url.pathname);
  const folder = /^\/drive\/u\/\d+\/folders\/([a-zA-Z0-9_-]{1,256})\/?$/.exec(url.pathname);
  if (url.origin !== "https://drive.google.com" || (!root && !folder) || url.searchParams.has("resourcekey")) {
    return { ok: false, code: "unsupported_view" };
  }

  for (const element of document.querySelectorAll('a[aria-label], button[aria-label], [role="button"][aria-label]')) {
    const label = element.getAttribute("aria-label");
    if (!/Google Account|Google 账号|Google 帳戶/i.test(label)) continue;
    if (element.closest('[hidden], [aria-hidden="true"]') || !element.getClientRects().length) continue;
    const style = getComputedStyle(element);
    if (style.visibility !== "visible" || style.opacity === "0") continue;
    const email = label.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0];
    if (!email) continue;
    return { ok: true, request: {
      version: 1, type: "open-google-drive-folder", request_id: requestId,
      account_email: email.toLowerCase(),
      location: root ? { kind: "root" } : { kind: "id", value: folder[1] },
    } };
  }
  return { ok: false, code: "account_email_unverified" };
}
