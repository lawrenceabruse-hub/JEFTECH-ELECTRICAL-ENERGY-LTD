"use strict";

function initializeWorkCarousel() {
  const viewport = document.querySelector("#work-viewport");
  const gallery = document.querySelector("#work-gallery");
  const counter = document.querySelector("#work-counter");
  const previousButton = document.querySelector("#work-previous");
  const nextButton = document.querySelector("#work-next");

  if (!viewport || !gallery || !counter || !previousButton || !nextButton || gallery.children.length === 0) return;

  const originalSlides = [...gallery.children];
  const slideCount = originalSlides.length;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let activeIndex = 0;
  let autoSlideTimer;
  let isPaused = false;

  originalSlides.forEach((slide, index) => {
    slide.setAttribute("role", "group");
    slide.setAttribute("aria-roledescription", "slide");
    slide.setAttribute("aria-label", `${index + 1} of ${slideCount}`);
  });

  originalSlides.forEach((slide) => {
    const clone = slide.cloneNode(true);
    clone.setAttribute("aria-hidden", "true");
    clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    gallery.append(clone);
  });

  function updateCounter() {
    const displayedIndex = activeIndex % slideCount;
    counter.firstChild.textContent = `${String(displayedIndex + 1).padStart(2, "0")} `;
    counter.lastChild.textContent = ` ${String(slideCount).padStart(2, "0")}`;
    counter.setAttribute("aria-label", `Photo ${displayedIndex + 1} of ${slideCount}`);
  }

  function moveTo(index) {
    activeIndex = index;
    const distance = gallery.children[index].offsetLeft - gallery.children[0].offsetLeft;
    gallery.style.transform = `translateX(-${distance}px)`;
    updateCounter();
  }

  function next() {
    moveTo(activeIndex + 1);
  }

  function previous() {
    if (activeIndex === 0) {
      gallery.style.transition = "none";
      moveTo(slideCount);
      gallery.offsetHeight;
      gallery.style.removeProperty("transition");
      requestAnimationFrame(() => moveTo(slideCount - 1));
      return;
    }
    moveTo(activeIndex - 1);
  }

  function stopAutoSlide() {
    window.clearInterval(autoSlideTimer);
    autoSlideTimer = undefined;
  }

  function startAutoSlide() {
    stopAutoSlide();
    if (!isPaused && !reducedMotion.matches && !document.hidden) {
      autoSlideTimer = window.setInterval(next, 4500);
    }
  }

  gallery.addEventListener("transitionend", (event) => {
    if (event.target !== gallery || activeIndex < slideCount) return;
    gallery.style.transition = "none";
    moveTo(activeIndex - slideCount);
    gallery.offsetHeight;
    gallery.style.removeProperty("transition");
  });

  previousButton.addEventListener("click", () => {
    previous();
    startAutoSlide();
  });

  nextButton.addEventListener("click", () => {
    next();
    startAutoSlide();
  });

  viewport.addEventListener("mouseenter", () => {
    isPaused = true;
    stopAutoSlide();
  });

  viewport.addEventListener("mouseleave", () => {
    isPaused = false;
    startAutoSlide();
  });

  viewport.addEventListener("focusin", () => {
    isPaused = true;
    stopAutoSlide();
  });

  viewport.addEventListener("focusout", (event) => {
    if (!viewport.contains(event.relatedTarget)) {
      isPaused = false;
      startAutoSlide();
    }
  });

  document.addEventListener("visibilitychange", startAutoSlide);
  reducedMotion.addEventListener("change", startAutoSlide);
  window.addEventListener("resize", () => moveTo(activeIndex));

  moveTo(0);
  startAutoSlide();
}

window.jeftechContentReady.then(initializeWorkCarousel);
