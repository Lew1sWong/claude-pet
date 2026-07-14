/* Tiny renderer-side i18n helper. Main sends {lang, dict, lines} via the
   "i18n" channel; renderers stash it on window and call applyI18n() to fill
   any [data-i18n] / [data-i18n-title] elements. t(key) is the lookup. */
(function () {
  window.t = (k) => (window.I18N && window.I18N[k] != null ? window.I18N[k] : k);
  window.applyI18n = function (root) {
    const r = root || document;
    r.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = window.t(el.getAttribute("data-i18n")); });
    r.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = window.t(el.getAttribute("data-i18n-title")); });
    r.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = window.t(el.getAttribute("data-i18n-ph")); });
  };
})();
