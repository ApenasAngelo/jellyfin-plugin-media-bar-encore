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
   * from that library or collection. The Collections page shows everything, as the home does, so it has no banner.
   */
  function pageOf(hash) {
    if (!/^#\/home\?/.test(hash)) {
      return null;
    }
    var query = new URLSearchParams(hash.split('?')[1]);
    if (!query.has('topParentId') || query.has('tab')) {
      return null;
    }
    if (query.has('encoreKind')) {
      return null;
    }
    return { parent: query.get('encoreCollection') || query.get('topParentId') };
  }

  // Without a banner the rows start at the top; the author's CSS keeps room for it on any home page.
  (function rowsWithoutBanner() {
    function mark() {
      var hash = window.location.hash;
      var without = /^#\/home\?/.test(hash) && new URLSearchParams(hash.split('?')[1]).has('encoreKind');
      document.body && document.body.classList.toggle('encore-no-banner', without);
    }
    var style = document.createElement('style');
    style.textContent = 'body.encore-no-banner .homeSectionsContainer{top:0!important;margin-top:0!important}' +
      'body.encore-no-banner .homePage .sections{padding-top:5em}';
    document.head.appendChild(style);
    window.addEventListener('hashchange', mark);
    setInterval(mark, 300);
    mark();
  })();

  window.mediaBarEncoreView = function () {
    return pageOf(window.location.hash);
  };

  /*
   * Asking the server for random titles is the slowest step of the banner (3 to 5 s, more with the rows loading at the same
   * time). Each page opens with the list saved for it, reshuffled, and asks for a new one in the background for the next
   * visit. Only the first visit of a page on a device waits for the server.
   */
  (function savedSlideLists() {
    var MAX_AGE = 14 * 24 * 3600 * 1000;
    var REFRESH_AFTER = 15000; // after the page has settled, so it does not compete with the rows

    function key(source) {
      var user = window.ApiClient && window.ApiClient.getCurrentUserId && window.ApiClient.getCurrentUserId();
      return 'encore-slides-' + user + '-' + (source || 'home');
    }

    function read(source) {
      try {
        var saved = JSON.parse(localStorage.getItem(key(source)));
        return saved && Date.now() - saved.at < MAX_AGE && saved.ids.length ? saved.ids : null;
      } catch (e) {
        return null;
      }
    }

    function save(source, ids) {
      try {
        if (ids && ids.length) {
          localStorage.setItem(key(source), JSON.stringify({ at: Date.now(), ids: ids }));
        }
      } catch (e) { /* no storage: every visit asks the server */ }
    }

    function source() {
      var page = pageOf(window.location.hash);
      return page ? page.parent : '';
    }

    function wrap() {
      var mb = window.mediaBarEnhanced;
      if (!mb || !mb.ApiUtils) {
        return setTimeout(wrap, 50);
      }
      var ask = mb.ApiUtils.fetchItemIdsFromServer;
      mb.ApiUtils.fetchItemIdsFromServer = function () {
        var asked = source();
        var saved = read(asked);
        // The answer is only for this page if the user is still on it when it arrives.
        var askAndSave = function () {
          return ask.call(mb.ApiUtils).then(function (ids) {
            if (source() === asked) {
              save(asked, ids);
            }
            return ids;
          });
        };
        if (!saved) {
          return askAndSave();
        }
        setTimeout(function () {
          if (source() === asked && !document.hidden) {
            askAndSave();
          }
        }, REFRESH_AFTER);
        return Promise.resolve(mb.SlideUtils.shuffleArray(saved.slice()));
      };
    }
    wrap();
  })();

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
      slideshow.isPaused = window.mediaBarEncoreHoldPause(); // a new page does not undo a pause
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
   * The trailer stays paused for as long as the user paused it or the banner is out of view (S8). This is a state checked
   * all the time and not a reaction to events, because the slides are rebuilt on every page: a scroll during that has no
   * running slideshow to pause and sends no second event, and a pause would be forgotten with the old slides.
   */
  (function holdThePause() {
    var VISIBLE_RATIO = 0.25; // below this share of the banner on screen, it counts as out of view
    var userPaused = false;
    var pausedByUs = false;
    var ours = false; // togglePause called from here, not by the button or the keyboard
    var heldPlayer = null;

    function offscreen() {
      var container = document.getElementById('slides-container');
      if (!container || container.classList.contains('media-bar-hidden') || document.hidden) {
        return false; // hidden by the Media Bar itself (other page, video player open): it handles playback there
      }
      var box = container.getBoundingClientRect();
      if (!box.height) {
        return false;
      }
      return (Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0)) / box.height < VISIBLE_RATIO;
    }

    window.mediaBarEncoreHoldPause = function () {
      return userPaused || offscreen();
    };

    function wrap(manager) {
      if (manager.encoreHold) {
        return;
      }
      manager.encoreHold = true;
      var toggle = manager.togglePause;
      manager.togglePause = function () {
        var slideshow = window.mediaBarEnhanced.STATE.slideshow;
        if (!slideshow.slideInterval) {
          return undefined; // upstream needs a running slideshow; the state is checked again right after it starts
        }
        if (!ours) {
          userPaused = !slideshow.isPaused;
          pausedByUs = false;
        }
        return toggle.apply(this, arguments);
      };
      // Nothing may advance the slides while the banner is out of view: a trailer ending or a timer would move on.
      var nextSlide = manager.nextSlide;
      manager.nextSlide = function () {
        return offscreen() ? undefined : nextSlide.apply(this, arguments);
      };
    }

    function ourToggle(manager) {
      ours = true;
      try {
        manager.togglePause();
      } finally {
        ours = false;
      }
    }

    // togglePause only reaches a player that already plays, so one that starts later would play on while the button says
    // paused. Also hides it as togglePause does, so the paused YouTube frame and its own center icon are not shown.
    function holdThePlayer(slideshow) {
      var itemId = (slideshow.itemIds || [])[slideshow.currentSlideIndex];
      var player = slideshow.videoPlayers && slideshow.videoPlayers[itemId];
      if (player && typeof player.getPlayerState === 'function' && typeof player.pauseVideo === 'function') {
        var state = player.getPlayerState();
        heldPlayer = player;
        if (state === 1 || state === 3) { // YT.PlayerState PLAYING, BUFFERING
          try {
            player.pauseVideo();
          } catch (e) { /* its iframe is already gone */ }
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
    }

    setInterval(function () {
      var mb = window.mediaBarEnhanced;
      var slideshow = mb && mb.STATE && mb.STATE.slideshow;
      if (!slideshow || !mb.SlideshowManager) {
        return;
      }
      wrap(mb.SlideshowManager);
      var hold = window.mediaBarEncoreHoldPause();
      var running = slideshow.slideInterval && (slideshow.itemIds || []).length;
      if (hold && !slideshow.isPaused && running) {
        ourToggle(mb.SlideshowManager);
        pausedByUs = !userPaused;
      } else if (!hold && slideshow.isPaused && pausedByUs && running) {
        pausedByUs = false;
        ourToggle(mb.SlideshowManager);
      }
      if (hold || slideshow.isPaused) {
        holdThePlayer(slideshow);
        return;
      }
      // The author's autoplay fallback mutes a player it finds not playing, which a held trailer is: give the sound back.
      if (heldPlayer && !slideshow.isMuted && typeof heldPlayer.unMute === 'function') {
        try {
          heldPlayer.unMute();
        } catch (e) { /* its iframe is already gone */ }
      }
      heldPlayer = null;
    }, 100);
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
