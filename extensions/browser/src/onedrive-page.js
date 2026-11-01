// This function is serialized by scripting.executeScript: keep all dependencies inside it.
export async function extractOneDriveFolder(requestId) {
  class ExtractionError extends Error {}
  const fail = (code) => { throw new ExtractionError(code); };
  const text = (value, max, required = false) => {
    if (value === undefined || value === null) {
      if (required) fail("context_unavailable");
      return undefined;
    }
    if (typeof value !== "string" || !value.trim() || value.length > max ||
        /[\u0000-\u001f\u007f]/u.test(value)) fail("invalid_page_data");
    return value;
  };
  const snapshot = () => {
    const context = window._spPageContextInfo;
    if (!context) fail("context_unavailable");
    // userCid alone has no proven radix. Never reinterpret an all-digit value as hex.
    const hex = context.userHexCid;
    const cid = text(hex ?? context.userCid, 16, true);
    if (!/^[0-9a-f]{16}$/iu.test(cid) ||
        (hex == null && !/[a-f]/iu.test(cid))) fail("account_format_unsupported");
    return {
      href: location.href,
      cid,
      web: text(context.webAbsoluteUrl, 2048, true),
      list: text(context.listUrl, 2048, true),
      email: text(context.userEmail ?? window.$Config?.email, 320),
      name: text(context.userDisplayName, 256),
    };
  };
  let timer;
  let timeout;
  const controller = new AbortController();
  let changed = false;
  let timedOut = false;
  const markChanged = () => { changed = true; controller.abort(); };
  try {
    const start = snapshot();
    const url = new URL(start.href);
    // An allowlist deliberately excludes aggregate views and unverified query modes.
    const allowed = new Set(["id", "viewid", "cid", "o", "sortField", "isAscending"]);
    if (url.origin !== "https://onedrive.live.com" || !/^\/my\/?$/u.test(url.pathname) ||
        url.hash || [...url.searchParams.keys()].some((key) => !allowed.has(key)) ||
        [...allowed].some((key) => url.searchParams.getAll(key).length > 1)) fail("unsupported_view");
    if (url.searchParams.has("viewid") &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(url.searchParams.get("viewid"))) fail("unsupported_view");
    if (url.searchParams.has("cid") &&
        url.searchParams.get("cid").toLowerCase() !== start.cid.toLowerCase()) fail("unsupported_scope");
    let web;
    try { web = new URL(start.web); }
    catch { fail("invalid_page_data"); }
    if (web.origin !== url.origin || !/^\/personal\/[^/]+\/?$/u.test(web.pathname) ||
        web.search || web.hash) fail("unsupported_scope");
    const list = start.list.replace(/\/$/u, "");
    // listUrl and query id are server-relative paths, not DriveItem IDs.
    if (!list.startsWith(`${web.pathname.replace(/\/$/u, "")}/`) ||
        /[?#\\]/u.test(list)) fail("unsupported_scope");
    const target = url.searchParams.has("id") ? url.searchParams.get("id") : list;
    if (target !== list && !target.startsWith(`${list}/`)) fail("unsupported_scope");
    const relative = target === list ? "" : target.slice(list.length + 1);
    const segments = relative ? relative.split("/") : [];
    if (segments.some((part) => !part || part === "." || part === ".." || part.includes("\\"))) {
      fail("unsupported_scope");
    }
    const monitor = () => {
      try { if (JSON.stringify(snapshot()) !== JSON.stringify(start)) markChanged(); }
      catch (error) {
        if (!(error instanceof ExtractionError)) throw error;
        markChanged(); // A lost/unsupported page context invalidates this extraction.
      }
    };
    const unchanged = () => {
      monitor();
      if (changed) fail("page_changed");
    };
    window.addEventListener("popstate", markChanged);
    window.addEventListener("hashchange", markChanged);
    window.navigation.addEventListener("navigate", markChanged);
    timer = setInterval(monitor, 50);
    timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 10000);
    const endpoint = `${web.href.replace(/\/$/u, "")}/_api/v2.0/drive/root` +
      (segments.length ? `:/${segments.map(encodeURIComponent).join("/")}` : "");
    const read = async (apiUrl) => {
      let response;
      try {
        response = await fetch(apiUrl, { credentials: "include", redirect: "error",
          headers: { Accept: "application/json;odata=nometadata" }, signal: controller.signal });
      } catch {
        unchanged();
        fail(timedOut ? "request_timeout" : "network_error");
      }
      unchanged();
      if (!response.ok) {
        fail(({ 401: "auth_required", 403: "permission_denied", 404: "directory_unavailable",
          429: "rate_limited" })[response.status] ?? "provider_error");
      }
      let data;
      try { data = await response.json(); }
      catch { unchanged(); fail(timedOut ? "request_timeout" : "invalid_response"); }
      unchanged();
      if (!data || typeof data !== "object" || !data.folder ||
          typeof data.folder !== "object" || Array.isArray(data.folder)) fail("invalid_response");
      if (data.remoteItem) fail("unsupported_scope");
      if (typeof data.id !== "string" || !data.id.trim() || data.id.length > 256 ||
          /[\u0000-\u001f\u007f]/u.test(data.id)) fail("invalid_response");
      return data;
    };
    const data = await read(endpoint);
    const driveId = text(data.parentReference?.driveId, 256);
    if (segments.length && !driveId) fail("scope_unverified");
    const request = { version: 1, type: "open-onedrive-folder", request_id: requestId,
      account_cid: start.cid, folder_id: data.id };
    for (const [key, value] of Object.entries({ drive_id: driveId,
      account_email: start.email, account_display_name: start.name,
      folder_name: text(data.name, 256) })) {
      if (value !== undefined) request[key] = value;
    }
    unchanged();
    return { ok: true, request };
  } catch (error) {
    if (!(error instanceof ExtractionError)) throw error;
    return { ok: false, code: changed ? "page_changed" : error.message };
  } finally {
    clearInterval(timer);
    clearTimeout(timeout);
    window.removeEventListener("popstate", markChanged);
    window.removeEventListener("hashchange", markChanged);
    window.navigation.removeEventListener("navigate", markChanged);
  }
}
