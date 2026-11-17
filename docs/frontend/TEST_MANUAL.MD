# 在浏览器模拟执行响应丢失

[文档索引](../README.md) · [前端测试](TEST.md) · [执行契约](../api/executions/index.md)

本场景由用户手动执行，结果记录在[对应任务文档](../generated/README.md)。


用于核对单项或批量写入响应丢失后的保护与恢复流程。**这会真实提交改名请求，请使用测试文件。** 脚本把下一次单项或批量改名请求发给服务端。收到 HTTP 成功响应后，它向前端抛出网络错误，模拟客户端丢失响应。命中请求时，脚本会自动恢复原来的 `fetch`。服务端返回 HTTP 错误时，前端照常收到错误响应。

1. 在 Rename Studio 工作台打开浏览器开发者工具（F12），切到 Console，粘贴并执行下方脚本。
2. 正常提交一次单项或批量改名。看到控制台的模拟提示后，确认界面进入待核对状态，新的预览和执行被锁定。
3. 切换目录后确认待核对状态仍保留。回到发起操作的目录核对实际文件名，再点**应用内的目录刷新按钮**。原目录手动或自动读取成功后解除保护，可直接单项改名或重新批量预览。浏览器整页刷新会清空前端内存状态。

```js
(() => {
  const originalFetch = window.fetch;

  window.fetch = async function (input, options) {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      location.href,
    );
    const method = (
      options?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();

    const isRename =
      url.origin === location.origin &&
      method === "POST" &&
      (
        url.pathname === "/api/rename/execute" ||
        /^\/api\/storages\/[^/]+\/rename\/single\/execute$/.test(url.pathname)
      );

    if (!isRename) return originalFetch.call(window, input, options);

    window.fetch = originalFetch;
    const response = await originalFetch.call(window, input, options);
    if (!response.ok) return response;

    console.info("已收到服务端成功响应，模拟前端丢失该响应");
    throw new TypeError("Failed to fetch (simulated lost rename response)");
  };
})();
```

