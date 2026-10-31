import { mountFloatingButton } from "./floating-button.js";
import { NAMESPACE, validCode, validReply } from "./protocol.js";
import { deadline } from "./transport.js";

if (window.top === window && location.origin === "https://onedrive.live.com") {
  mountFloatingButton(async (accepted) => {
    const requestId = crypto.randomUUID();
    const receive = (message, sender) => {
      if (sender.id === chrome.runtime.id && message?.namespace === NAMESPACE &&
          message.type === "accepted" && message.request_id === requestId && Object.keys(message).length === 3) accepted();
    };
    try {
      chrome.runtime.onMessage.addListener(receive);
      const reply = await deadline(chrome.runtime.sendMessage({ namespace: NAMESPACE,
        type: "open-current-folder", request_id: requestId }), 35000, "result_timeout");
      if (validReply(reply, requestId) && reply.status !== "accepted") return reply;
      if (["rejected", "unconfirmed"].includes(reply?.transport) && validCode(reply.code)) return reply;
      return { code: "result_timeout" };
    } catch {
      // Disconnection may occur after delivery. It does not prove that navigation failed.
      return { code: "result_timeout" };
    } finally { chrome.runtime.onMessage.removeListener(receive); }
  }, (key, substitutions) => chrome.i18n.getMessage(key, substitutions));
}
