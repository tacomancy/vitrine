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
//
// On anything wider the twelve sections would be a very long scroll, so the
// contents become a tab strip and one section shows at a time. Without
// JavaScript, or on a phone, the page is the stacked list the markup already
// is.
(function () {
  const DESIGN_WIDTH = 1528;
  const MIN_SCALE = 0.5;
  const frames = Array.from(document.querySelectorAll(".frame"));

  function fit(frame) {
    const fitted = frame.clientWidth / DESIGN_WIDTH;
    frame.style.setProperty("--scale", String(Math.min(1, Math.max(MIN_SCALE, fitted))));
    frame.classList.toggle("scrolls", fitted < MIN_SCALE);
  }

  // Stacked: a link into the page (#hypothesis) lands before the prototypes
  // above it have loaded, and each one that loads grows past its placeholder
  // height and pushes the target down, by screens. So the linked section is
  // held in view as frames settle, until the reader scrolls on their own.
  // Tabbed, nothing sits above the shown section, so the pin never fires.
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

  // --- The tabbed viewer.

  const wide = window.matchMedia("(min-width: 48rem)");
  const strip = document.querySelector(".toc");
  const tabs = Array.from(strip.querySelectorAll("a[href^='#']"));
  const sections = tabs.map((tab) => document.getElementById(tab.hash.slice(1)));

  function select(index, { scroll } = { scroll: false }) {
    sections.forEach((section, i) => section.classList.toggle("selected", i === index));
    tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    // Hidden sections never intersected and measured a zero-width frame.
    const frame = sections[index].querySelector(".frame");
    fit(frame);
    load(frame);
    if (scroll) sections[index].scrollIntoView();
  }

  function indexOfHash() {
    const i = sections.findIndex((section) => "#" + section.id === location.hash);
    return i < 0 ? 0 : i;
  }

  // The roles come and go with the layout: stacked, these are a list of links
  // and plain sections, which is what the markup says without help.
  function apply({ arriving }) {
    document.body.classList.toggle("tabbed", wide.matches);
    strip.querySelector("ol").setAttribute("role", wide.matches ? "tablist" : "list");
    tabs.forEach((tab, i) => {
      const section = sections[i];
      if (wide.matches) {
        tab.id = "tab-" + section.id;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", section.id);
        section.setAttribute("role", "tabpanel");
        section.setAttribute("aria-labelledby", tab.id);
      } else {
        ["role", "aria-controls", "aria-selected", "tabindex"].forEach((name) => tab.removeAttribute(name));
        ["role", "aria-labelledby"].forEach((name) => section.removeAttribute(name));
      }
    });
    if (wide.matches) {
      document.body.style.setProperty("--strip-height", strip.offsetHeight + "px");
      // Arriving by link, the browser jumped before the other sections were
      // hidden, so the target is somewhere else now.
      select(indexOfHash(), { scroll: arriving && location.hash !== "" });
    } else {
      sections.forEach((section) => section.classList.remove("selected"));
      frames.forEach(fit);
    }
  }

  apply({ arriving: true });
  wide.addEventListener("change", () => apply({ arriving: false }));
  window.addEventListener("resize", () => {
    if (wide.matches) document.body.style.setProperty("--strip-height", strip.offsetHeight + "px");
  });

  // A tab click is a view change, not a navigation: the hash is replaced so
  // the link stays shareable, without a history entry per tab.
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", (event) => {
      if (!wide.matches) return;
      event.preventDefault();
      history.replaceState(null, "", tab.hash);
      select(i, { scroll: true });
    });
  });
  strip.addEventListener("keydown", (event) => {
    if (!wide.matches) return;
    const current = tabs.findIndex((tab) => tab === document.activeElement);
    if (current < 0) return;
    const last = tabs.length - 1;
    const next = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const i = (next + tabs.length) % tabs.length;
    history.replaceState(null, "", tabs[i].hash);
    select(i, { scroll: true });
    tabs[i].focus();
  });
  // Back, forward, or a typed hash.
  window.addEventListener("hashchange", () => { if (wide.matches) select(indexOfHash(), { scroll: true }); });
})();
