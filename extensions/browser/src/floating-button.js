export function mountFloatingButton(open, message, page = window) {
  const document = page.document;
  const hostId = "rename-studio-folder-button";
  if (document.getElementById(hostId)) return;
  // Keep essential feedback usable even if an extension reload invalidates Chrome APIs mid-request.
  const feedback = { opening: message("opening"), accepted: message("accepted"),
    success: message("openSuccess"), unconfirmed: message("reason_result_timeout") };
  const host = document.createElement("div");
  host.id = hostId;
  host.style.cssText = "all:initial;position:fixed;z-index:2147483000;width:44px;height:44px;pointer-events:none";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { color-scheme: light dark; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    button { all: unset; box-sizing: border-box; width:44px; height:44px; border-radius:14px;
      display:grid; place-items:center; background:#007a4b; color:#fff; cursor:pointer;
      border:1px solid #005c38; box-shadow:0 2px 8px #14231d30; pointer-events:auto;
      touch-action:none; user-select:none; }
    button:hover { background:#005c38; }
    button:focus-visible { outline:3px solid #007a4b; outline-offset:4px; box-shadow:0 0 0 4px #fff; }
    button[aria-disabled=true] { cursor:wait; }
    md-icon, md-circular-progress { pointer-events:none; }
    md-circular-progress { --md-circular-progress-size:24px; --md-circular-progress-active-indicator-color:currentColor; }
    svg { width:24px; height:24px; fill:currentColor; }
    .tooltip, .status { position:fixed; margin:0; padding:8px 10px; border-radius:10px;
      background:#101a16; color:#f1f7f4; font:13px/1.5 system-ui,sans-serif;
      overflow-wrap:anywhere; max-width:min(280px,calc(100vw - 16px)); pointer-events:none; }
    .tooltip { visibility:hidden; }
    button:hover ~ .tooltip, button:focus-visible ~ .tooltip { visibility:visible; }
    :host([data-dragging]) .tooltip { visibility:hidden; }
    :host([data-status]) .tooltip { visibility:hidden; }
    .sr { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); }
    @media (prefers-color-scheme:dark) {
      button { background:#00ff9d; color:#04130d; border-color:#35f2a3; }
      button:hover { background:#72ffc4; }
      button:focus-visible { outline-color:#00ff9d; box-shadow:0 0 0 4px #08110e; }
    }
    @media (forced-colors:active) { button { border:2px solid ButtonText; } }
  `;
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", message("openInStudio"));
  button.setAttribute("aria-describedby", "drag-hint");
  const icon = document.createElement("md-icon");
  icon.setAttribute("aria-hidden", "true");
  // Material open_in_new SVG in md-icon: no remote font dependency.
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", "M19 19H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z");
  svg.append(path);
  icon.append(svg);
  const progress = document.createElement("md-circular-progress");
  progress.setAttribute("indeterminate", "");
  progress.setAttribute("aria-label", message("opening"));
  progress.hidden = true;
  button.append(icon, progress);
  const hint = document.createElement("span");
  hint.id = "drag-hint";
  hint.className = "sr";
  hint.textContent = message("dragHint");
  const tooltip = document.createElement("span");
  tooltip.className = "tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.textContent = message("openInStudio");
  const status = document.createElement("p");
  status.className = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  shadow.append(style, button, hint, tooltip, status);

  let x, y, moved = false, busy = false, dragging = null, suppressClick = false, hideTimer;
  const clamp = (value, maximum) => Math.max(8, Math.min(value, Math.max(8, maximum)));
  const position = () => {
    x = clamp(moved ? x : page.innerWidth - 60, page.innerWidth - 52);
    y = clamp(moved ? y : (page.innerHeight - 44) / 2, page.innerHeight - 52);
    host.style.left = `${x}px`;
    host.style.top = `${y}px`;
    for (const label of [tooltip, status]) {
      const width = Math.min(280, Math.max(44, page.innerWidth - 16));
      label.style.width = `${width}px`;
      label.style.left = `${clamp(x - width - 8, page.innerWidth - width - 8)}px`;
      label.style.top = `${clamp(x < width + 16 ? y + 52 : y, page.innerHeight - 100)}px`;
    }
  };
  const announce = (text, temporary = false) => {
    clearTimeout(hideTimer);
    status.textContent = text;
    status.hidden = false;
    host.dataset.status = "";
    if (temporary) hideTimer = setTimeout(() => { status.hidden = true; delete host.dataset.status; }, 8000);
  };
  button.addEventListener("pointerdown", (event) => {
    if (busy || event.button !== 0 || event.isPrimary === false) return;
    button.focus({ preventScroll: true });
    dragging = { id: event.pointerId, startX: event.clientX, startY: event.clientY, x, y, moved: false };
    button.setPointerCapture(event.pointerId);
  });
  button.addEventListener("pointermove", (event) => {
    if (!dragging || dragging.id !== event.pointerId) return;
    const dx = event.clientX - dragging.startX, dy = event.clientY - dragging.startY;
    if (!dragging.moved && Math.hypot(dx, dy) < 6) return;
    dragging.moved = moved = true;
    host.dataset.dragging = "";
    x = dragging.x + dx;
    y = dragging.y + dy;
    position();
  });
  const stopDrag = (event) => {
    if (!dragging || dragging.id !== event.pointerId) return;
    suppressClick = dragging.moved && event.type === "pointerup";
    dragging = null;
    delete host.dataset.dragging;
    setTimeout(() => { suppressClick = false; }, 0);
  };
  button.addEventListener("pointerup", stopDrag);
  button.addEventListener("pointercancel", stopDrag);
  button.addEventListener("lostpointercapture", stopDrag);
  button.addEventListener("click", async () => {
    if (suppressClick || busy) return;
    busy = true;
    icon.hidden = true;
    progress.hidden = false;
    button.setAttribute("aria-busy", "true");
    button.setAttribute("aria-disabled", "true");
    announce(feedback.opening);
    try {
      const result = await open(() => announce(feedback.accepted));
      const text = result.status === "opened" ? feedback.success :
        message(`reason_${result.code.toLowerCase()}`) || message("navigationRejected", result.code);
      announce(text, true);
    } catch {
      // Extension reload/disconnection can invalidate the runtime even during listener cleanup.
      announce(feedback.unconfirmed, true);
    } finally {
      busy = false;
      icon.hidden = false;
      progress.hidden = true;
      button.removeAttribute("aria-busy");
      button.removeAttribute("aria-disabled");
    }
  });
  page.addEventListener("resize", position);
  const ensureMounted = () => { if (!host.isConnected) document.documentElement.append(host); };
  ensureMounted();
  // The host is outside the SPA body; only direct root removal requires observation.
  const observer = new MutationObserver(ensureMounted);
  observer.observe(document.documentElement, { childList: true });
  position();
  return { host, button, status, progress, dispose: () => {
    observer.disconnect();
    page.removeEventListener("resize", position);
    clearTimeout(hideTimer);
    host.remove();
  } };
}
