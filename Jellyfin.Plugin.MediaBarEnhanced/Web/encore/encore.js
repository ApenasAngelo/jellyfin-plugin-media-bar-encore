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
   * Library and collection pages are the home page at #/home?topParentId=<id> (Home Screen Sections Encore). The slides come
   * from that library or collection; the Collections page itself has no titles of its own and keeps the slides of the home.
   */
  function pageOf(hash) {
    if (!/^#\/home\?/.test(hash)) {
      return null;
    }
    var query = new URLSearchParams(hash.split('?')[1]);
    if (!query.has('topParentId') || query.has('tab')) {
      return null;
    }
    return { parent: query.get('encoreCollection') || (query.has('encoreKind') ? '' : query.get('topParentId')) };
  }

  window.mediaBarEncoreView = function () {
    return pageOf(window.location.hash);
  };

  (function changeSlidesWithThePage() {
    var loadedFor = null;

    function sourceOf(hash) {
      var page = pageOf(hash);
      return page ? page.parent : '';
    }

    function swap(source) {
      var mb = window.mediaBarEnhanced;
      var slideshow = mb.STATE.slideshow;
      loadedFor = source;
      if (slideshow.slideInterval) {
        slideshow.slideInterval.stop();
        slideshow.slideInterval = null;
      }
      mb.SlideshowManager.stopAllPlayback();
      Object.values(slideshow.videoPlayers || {}).forEach(function (player) {
        try {
          if (typeof player.destroy === 'function') {
            player.destroy();
          }
        } catch (e) { /* already gone */ }
      });
      document.querySelectorAll('#slides-container .slide').forEach(function (slide) {
        slide.remove();
      });
      slideshow.videoPlayers = {};
      slideshow.itemIds = [];
      slideshow.loadedItems = {};
      slideshow.createdSlides = {};
      slideshow.hasTrailer = {};
      slideshow.playSignals = {};
      slideshow.currentSlideIndex = 0;
      slideshow.isPaused = false;
      slideshow.isTransitioning = false;
      slideshow.isVideoPlaying = false;
      mb.initSlideshowData();
    }

    setInterval(function () {
      var mb = window.mediaBarEnhanced;
      if (!mb || !mb.STATE || !mb.STATE.slideshow.initialLoadComplete || mb.STATE.slideshow.isLoading) {
        return;
      }
      var hash = window.location.hash;
      if (loadedFor === null) {
        loadedFor = sourceOf(hash); // the first load happened right now, for this page
      }
      if (!pageOf(hash) && hash !== '#/home' && hash !== '#/home.html') {
        return; // another page: the slides only change when one of these opens
      }
      var source = sourceOf(hash);
      if (source !== loadedFor) {
        swap(source);
      }
    }, 300);
  })();

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

    // Nothing may advance the slides while the banner is out of view: a trailer ending or a hover timer resuming would
    // move on to the next slide, and the author's code unpauses on every video slide, so its trailer plays unseen.
    function holdSlidesWhileOffscreen() {
      var mb = window.mediaBarEnhanced;
      if (!mb || !mb.SlideshowManager || mb.SlideshowManager.encoreHold) {
        return;
      }
      var nextSlide = mb.SlideshowManager.nextSlide;
      mb.SlideshowManager.encoreHold = true;
      mb.SlideshowManager.nextSlide = function () {
        return pausedByUs ? undefined : nextSlide.apply(this, arguments);
      };
    }

    // The banner is rebuilt when the home page is opened again; a cheap check keeps the observer on the current one.
    setInterval(function () {
      holdSlidesWhileOffscreen();
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

  /*
   * A pause must win over a trailer that is still loading: togglePause only reaches a player that already plays, so one
   * that starts later (pause clicked before it loaded, or scrolled away) would play on while the button says paused.
   * Also hides it as togglePause does, so the paused YouTube frame and its own center icon are not shown.
   */
  (function enforcePause() {
    var heldPlayer = null;
    setInterval(function () {
      var mb = window.mediaBarEnhanced;
      var slideshow = mb && mb.STATE && mb.STATE.slideshow;
      if (!slideshow) {
        return;
      }
      if (!slideshow.isPaused) {
        // The author's autoplay fallback mutes a player it finds not playing, which a held trailer is: give the sound back.
        if (heldPlayer && !slideshow.isMuted && typeof heldPlayer.unMute === 'function') {
          heldPlayer.unMute();
        }
        heldPlayer = null;
        return;
      }
      var itemId = (slideshow.itemIds || [])[slideshow.currentSlideIndex];
      var player = slideshow.videoPlayers && slideshow.videoPlayers[itemId];
      if (player && typeof player.getPlayerState === 'function' && typeof player.pauseVideo === 'function') {
        var state = player.getPlayerState();
        heldPlayer = player;
        if (state === 1 || state === 3) { // YT.PlayerState PLAYING, BUFFERING
          player.pauseVideo();
        }
        if (player._wrapperDiv && player._wrapperDiv.style.opacity !== '0') {
          player._wrapperDiv.style.transition = 'opacity 0.5s ease-in-out';
          player._wrapperDiv.style.opacity = '0';
        }
      }
      var slide = document.querySelector('.slide[data-item-id="' + itemId + '"]');
      var video = slide && slide.querySelector('video');
      if (video && !video.paused) {
        video.pause();
      }
    }, 250);
  })();

  /*
   * A trailer that fails (blocked video, YouTube asking for a login) becomes a slide without trailer: no player, no
   * volume button, and the progress bar and the timer running together. Upstream only started the timer, so the bar
   * waited for the 5 s failsafe and stopped halfway through the slide.
   */
  window.mediaBarEncoreTrailerFailed = function (player, slide, itemId) {
    var mb = window.mediaBarEnhanced;
    if (!mb || !mb.STATE || !mb.SlideshowManager) {
      return;
    }
    var slideshow = mb.STATE.slideshow;
    if (slideshow.hasTrailer) {
      delete slideshow.hasTrailer[itemId]; // the low-memory mode would create the player again
    }
    if (slideshow.videoPlayers) {
      delete slideshow.videoPlayers[itemId];
    }
    try {
      player.destroy();
    } catch (e) { /* already gone */ }
    if (!slide) {
      return;
    }
    slide.querySelectorAll('.video-backdrop').forEach(function (element) {
      element.remove();
    });
    slide.classList.remove('with-video');
    if (!slide.classList.contains('active')) {
      return;
    }
    slideshow.isVideoPlaying = false;
    if (slideshow.failsafeTimeout) {
      clearTimeout(slideshow.failsafeTimeout);
      slideshow.failsafeTimeout = null;
    }
    var muteButton = document.querySelector('.mute-button');
    if (muteButton) {
      muteButton.style.display = 'none';
    }
    mb.SlideshowManager.updateProgressBar(false, slideshow.currentSlideIndex);
    if (slideshow.slideInterval && !slideshow.isPaused) {
      slideshow.slideInterval.restart();
    }
  };
})();
