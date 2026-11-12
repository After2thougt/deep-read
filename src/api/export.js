function collectBrowserData() {
  try {
    const settings = {};
    const theme = localStorage.getItem("deepread-theme");
    const readerFontSize = Number(localStorage.getItem("reader-font-size"));
    if (theme === "light" || theme === "dark") settings.theme = theme;
    if (Number.isInteger(readerFontSize) && readerFontSize >= 12 && readerFontSize <= 32) {
      settings.readerFontSize = readerFontSize;
    }

    return { settings };
  } catch {
    throw new Error("Browser preferences could not be read for export.");
  }
}

export async function exportUserData() {
  const browserData = collectBrowserData();
  let response;
  try {
    response = await fetch("/api/export", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ browserData }),
    });
  } catch {
    throw new Error("Unable to connect to DeepRead to export your data.");
  }

  if (!response.ok) {
    let message = `Export failed (${response.status}).`;
    try {
      const body = await response.json();
      if (typeof body.error === "string" && body.error) message = body.error;
    } catch {
      // Keep the status-based message when the server does not return JSON.
    }
    throw new Error(message);
  }

  const file = await response.blob();
  if (!file.size) throw new Error("The server returned an empty data export.");

  const filename = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1]
    || `deepread-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
