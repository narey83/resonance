/* Keep the offline scene independent of React and readiness polling. */
(() => {
  const toggle = document.querySelector("#motion-toggle");
  toggle.hidden = false;
  toggle.addEventListener("click", () => {
    const paused = toggle.getAttribute("aria-pressed") !== "true";
    document.body.dataset.motionPaused = String(paused);
    toggle.setAttribute("aria-pressed", String(paused));
    toggle.setAttribute(
      "aria-label",
      `${paused ? "Play" : "Pause"} background animation`,
    );
    toggle.firstElementChild.textContent = paused ? "▶" : "Ⅱ";
  });
})();
