(() => {
  const version = Date.now();
  const url = `/local/seagull-history-card.js?t=${version}`;

  import(url)
    .then(() => {
      console.info(`%c🐦 SEAGULL-HISTORY-CARD-LOADER%c loaded ${url}`, "color:#fff;background:#f97316;padding:2px 6px;border-radius:4px;font-weight:700;", "color:inherit;");
    })
    .catch((err) => {
      console.error("[seagull-history-card-loader] failed to load module", url, err);
    });
})();
