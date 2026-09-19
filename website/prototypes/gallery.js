// Each prototype was designed at 1528px wide and is anywhere from one to
// four screens tall, with states stacked below the fold. The frame scales
// the iframe to the column width and takes its height from the loaded
// document, so the whole prototype is in the page flow with no inner scroll
// and pointer events still map through the transform. Prototypes load only
// as they approach the viewport, so twelve of them don't start at once.
(function () {
  const DESIGN_WIDTH = 1528;
  const frames = Array.from(document.querySelectorAll(".frame"));

  function fit(frame) {
    frame.style.setProperty("--scale", String(Math.min(1, frame.clientWidth / DESIGN_WIDTH)));
  }

  function follow(frame, iframe) {
    // Same origin, so the document is readable. Height follows the content
    // because switching a state inside the prototype changes it.
    const doc = iframe.contentDocument;
    if (!doc || !doc.documentElement) return;
    const measure = () => frame.style.setProperty("--design-height", String(doc.documentElement.scrollHeight));
    measure();
    if ("ResizeObserver" in window) new ResizeObserver(measure).observe(doc.documentElement);
  }

  function load(frame) {
    const iframe = frame.querySelector("iframe");
    if (iframe.src) return;
    iframe.addEventListener("load", () => follow(frame, iframe));
    iframe.src = frame.dataset.src;
  }

  frames.forEach(fit);
  window.addEventListener("resize", () => frames.forEach(fit));

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
