// Each prototype was designed at 1528px wide and is anywhere from one to
// four screens tall, with states stacked below the fold. The frame scales
// the iframe to the column width and takes its height from the loaded
// document, so the whole prototype is in the page flow with no inner scroll
// and pointer events still map through the transform. Prototypes load only
// as they approach the viewport, so twelve of them don't start at once.
//
// On a phone, fitting the column would shrink a prototype to a quarter size:
// a thumbnail, not a prototype. Below MIN_SCALE the frame stops shrinking and
// scrolls sideways instead, so the type stays legible and the tabs stay
// tappable.
(function () {
  const DESIGN_WIDTH = 1528;
  const MIN_SCALE = 0.5;
  const frames = Array.from(document.querySelectorAll(".frame"));

  function fit(frame) {
    const fitted = frame.clientWidth / DESIGN_WIDTH;
    frame.style.setProperty("--scale", String(Math.min(1, Math.max(MIN_SCALE, fitted))));
    frame.classList.toggle("scrolls", fitted < MIN_SCALE);
  }

  // A link into the page (#hypothesis) lands before the prototypes above it
  // have loaded, and each one that loads grows past its placeholder height
  // and pushes the target down, by screens. So the linked section is held
  // in view as frames settle, until the reader scrolls on their own.
  let pinned = null;
  function pin() { pinned = location.hash ? document.getElementById(location.hash.slice(1)) : null; }
  pin();
  window.addEventListener("hashchange", pin);
  // Any sign the reader has taken over. Events inside a prototype don't reach
  // this window, but focus moving into one blurs it, so blur covers a click
  // or tap on a tab.
  ["wheel", "touchstart", "keydown", "blur"].forEach((type) =>
    window.addEventListener(type, () => { pinned = null; }, { passive: true }));
  // Only a frame above the target moves it; one below just lengthens the page.
  function precedes(frame) {
    return pinned !== null && (frame.compareDocumentPosition(pinned) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }

  function follow(frame, iframe) {
    // Same origin, so the document is readable. Height follows the content
    // because switching a state inside the prototype changes it.
    const doc = iframe.contentDocument;
    if (!doc || !doc.documentElement) return;
    const measure = () => {
      frame.style.setProperty("--design-height", String(doc.documentElement.scrollHeight));
      if (precedes(frame)) pinned.scrollIntoView();
    };
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
