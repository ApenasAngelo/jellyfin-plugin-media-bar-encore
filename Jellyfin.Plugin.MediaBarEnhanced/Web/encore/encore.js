/*
 * Media Bar Encore: additions on top of Media Bar Enhanced. Loaded right after mediaBarEnhanced.js (same `defer`
 * order) and talks to it only through `window.mediaBarEnhanced` (STATE, SlideshowManager), so upstream files stay
 * untouched.
 */
(function () {
  'use strict';

  if (window.mediaBarEncoreLoaded) {
    return;
  }
  window.mediaBarEncoreLoaded = true;

  /*
   * S8: pause the slideshow (and the trailer) while the banner is scrolled out of view, and resume it when it comes
   * back. Uses the author's own pause (togglePause), so the video, the timer and the progress bar stay consistent.
   * It only resumes what it paused itself: a pause made by the user is left alone.
   */
  (function pauseWhenOffscreen() {
    var VISIBLE_RATIO = 0.25; // below this share of the banner on screen, it counts as out of view
    var observed = null;
    var pausedByUs = false;
    var observer = new IntersectionObserver(onIntersection, { threshold: [0, VISIBLE_RATIO, 0.5, 1] });

    function onIntersection(entries) {
      var mb = window.mediaBarEnhanced;
      if (!mb || !mb.STATE || !mb.SlideshowManager) {
        return;
      }
      var slideshow = mb.STATE.slideshow;
      if (!slideshow.slideInterval || !(slideshow.itemIds || []).length) {
        return; // not started yet (or nothing to show): togglePause needs a running slideshow
      }
      var entry = entries[entries.length - 1];
      if (entry.target.classList.contains('media-bar-hidden') || entry.boundingClientRect.height === 0) {
        return; // hidden by the Media Bar itself (other page, video player open): it handles playback there
      }
      var visible = entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO;

      if (!visible && !slideshow.isPaused && !document.hidden) {
        mb.SlideshowManager.togglePause();
        pausedByUs = true;
      } else if (visible && pausedByUs) {
        pausedByUs = false;
        if (slideshow.isPaused) {
          mb.SlideshowManager.togglePause();
        }
      }
    }

    // The banner is rebuilt when the home page is opened again; a cheap check keeps the observer on the current one.
    setInterval(function () {
      var container = document.getElementById('slides-container');
      if (container === observed) {
        return;
      }
      if (observed) {
        observer.unobserve(observed);
      }
      observed = container;
      pausedByUs = false;
      if (container) {
        observer.observe(container);
      }
    }, 1000);
  })();
})();
