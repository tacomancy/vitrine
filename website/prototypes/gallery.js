// Two jobs. Scale each frame so a 1528px-wide prototype fits the column
// while staying fully interactive (a CSS transform keeps pointer events
// mapped). And load each prototype only as it approaches the viewport,
// so twelve of them don't fetch fonts and run support.js at once.
(function () {
  const frames = Array.from(document.querySelectorAll(".frame"));

  function fit(frame) {
    const design = Number(frame.style.getPropertyValue("--design-width")) ||
      Number(getComputedStyle(frame).getPropertyValue("--design-width")) || 1528;
    const scale = Math.min(1, frame.clientWidth / design);
    frame.style.setProperty("--scale", String(scale));
  }

  function fitAll() { frames.forEach(fit); }
  fitAll();
  window.addEventListener("resize", fitAll);

  const load = (frame) => {
    const iframe = frame.querySelector("iframe");
    if (!iframe.src) iframe.src = frame.dataset.src;
  };

  if ("IntersectionObserver" in window) {
    const seen = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { load(entry.target); seen.unobserve(entry.target); }
      });
    }, { rootMargin: "600px 0px" });
    frames.forEach((frame) => seen.observe(frame));
  } else {
    frames.forEach(load);
  }
})();
