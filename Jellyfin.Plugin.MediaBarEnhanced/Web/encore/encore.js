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
   * Dot carousel (option DotCarousel): with many slides, 7 dots stay in view and the row moves under them. The 5 in the middle
   * are the main ones and the one at each end is translucent, which says there is more that way. All the dots exist, so
   * upstream marks the active one as usual; this only decides which of them show.
   */
  (function dotCarousel() {
    var VISIBLE = 7;
    var first = 0;
    var style = document.createElement('style');
    style.textContent =
      '.encore-dots{overflow:hidden;padding:8px 0}' +
      '.encore-dots-track{position:relative;display:flex;align-items:center;width:max-content;transition:transform .4s cubic-bezier(.4,0,.2,1)}' +
      '.encore-dots .dot{flex-shrink:0;transition:transform .4s cubic-bezier(.4,0,.2,1),background-color .4s ease-in-out,opacity .4s ease-in-out}' +
      '.encore-dots .dot.encore-dot-out{opacity:0}' +
      '.encore-dots .dot.encore-dot-edge{opacity:.45;transform:scale(.7)}';
    document.head.appendChild(style);

    function place(track, animate) {
      var from = track.children[first];
      var to = track.children[first + VISIBLE - 1];
      if (!from || !to.offsetWidth) {
        return; // hidden right now: placed again when the banner shows and its active dot is marked
      }
      var margin = track.children[0].offsetLeft; // the dot's own margin, kept on both sides of the row
      var box = track.parentNode;
      if (!animate) {
        track.style.transition = 'none';
      }
      box.style.width = (to.offsetLeft - from.offsetLeft + to.offsetWidth + margin * 2) + 'px';
      track.style.transform = 'translateX(' + -(from.offsetLeft - margin) + 'px)';
      if (!animate) {
        void track.offsetWidth;
        track.style.transition = '';
      }
    }

    window.mediaBarEncoreDots = {
      build: function (container, total) {
        var config = window.mediaBarEnhanced && window.mediaBarEnhanced.CONFIG;
        if (!config || config.dotCarousel === false || total <= VISIBLE) {
          return false;
        }
        var box = document.createElement('div');
        box.className = 'encore-dots';
        var track = document.createElement('div');
        track.className = 'encore-dots-track';
        for (var i = 0; i < total; i++) {
          var dot = document.createElement('span');
          dot.className = 'dot';
          dot.setAttribute('data-index', i);
          track.appendChild(dot);
        }
        box.appendChild(track);
        container.appendChild(box);
        first = 0;
        place(track, false);
        return true;
      },
      update: function (current, total) {
        var track = document.querySelector('.encore-dots-track');
        if (!track) {
          return;
        }
        // The active dot stays among the main ones, and reaches the end only at the first and the last slides.
        if (current > first + VISIBLE - 2) {
          first = current - (VISIBLE - 2);
        } else if (current < first + 1) {
          first = current - 1;
        }
        first = Math.max(0, Math.min(first, total - VISIBLE));
        for (var i = 0; i < track.children.length; i++) {
          var last = first + VISIBLE - 1;
          track.children[i].classList.toggle('encore-dot-out', i < first || i > last);
          track.children[i].classList.toggle('encore-dot-edge', i !== current && ((i === first && first > 0) || (i === last && last < total - 1)));
        }
        place(track, true);
      }
    };
  })();

  /*
   * Asking the server for random titles is the slowest step of the banner (3 to 5 s, more with the rows loading at the same
   * time). Each page opens with the list saved for it, reshuffled, and asks for a new one in the background for the next
   * visit. Only the first visit of a page on a device waits for the server.
   */
  (function savedSlideLists() {
    var MAX_AGE = 7 * 24 * 3600 * 1000;
    var MIN_SAVED = 5; // fewer than this still available: ask for a new list
    var REFRESH_AGE = 6 * 3600 * 1000; // a list this old gets replaced in the background; asking every visit held the server
    var FILL_START = 20000;
    var FILL_GAP = 10000;
    var REFRESH_AFTER = 30000; // after the page has settled, so it does not compete with the rows

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

    function isOld(source) {
      try {
        return Date.now() - JSON.parse(localStorage.getItem(key(source))).at > REFRESH_AGE;
      } catch (e) {
        return true;
      }
    }

    // Upstream asks 3 to 4 things per slide, one at a time, for this slide and the 6 around it. One request brings the data of
    // all the slides into upstream's own cache of items, and tells which titles are still in the library. The fields are the
    // ones upstream asks for, without MediaSources, which would make Gelato probe the sources.
    function loadDetails(mb, ids) {
      return window.ApiClient.getJSON(window.ApiClient.getUrl('Items', {
        Ids: ids.join(','), userId: window.ApiClient.getCurrentUserId(), enableUserData: true,
        Fields: 'Overview,RemoteTrailers,Genres,CommunityRating,CriticRating,OfficialRating,PremiereDate,ProductionYear,RunTimeTicks,LocalTrailerCount'
      })).then(function (found) {
        var slideshow = mb.STATE.slideshow;
        return (found.Items || []).map(function (item) {
          if (!mb.CONFIG.trailerEnabledLibraries) {
            item.MediaBarLibraryId = item.ParentId || 'any'; // only per-library trailer rules read it: no Ancestors request
          }
          slideshow.loadedItems[item.Id] = item;
          return item.Id;
        });
      });
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
        window.mediaBarEncoreAskedFor = asked;
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
        var askAndLoad = function () {
          return askAndSave().then(function (ids) {
            return loadDetails(mb, ids).then(function () {
              return ids;
            }, function () {
              return ids;
            });
          });
        };
        if (!saved) {
          return askAndLoad();
        }
        if (isOld(asked)) {
          setTimeout(function () {
            if (source() === asked && !document.hidden) {
              askAndSave();
            }
          }, REFRESH_AFTER);
        }
        // Titles leave the library: only the ones still available open the banner.
        return loadDetails(mb, saved).then(function (ids) {
          return ids.length >= MIN_SAVED ? mb.SlideUtils.shuffleArray(ids) : askAndLoad();
        }, askAndLoad);
      };
      // Only a fallback for a title without a remote trailer, unless local ones are preferred. Looking for one in a series goes
      // through its seasons, which made series slides the slowest.
      var findLocal = mb.ApiUtils.fetchLocalTrailer;
      mb.ApiUtils.fetchLocalTrailer = function (item) {
        var remote = item && item.RemoteTrailers && item.RemoteTrailers.length;
        // Without a remote trailer the search still ran, one request per season, and held the slide: the server already says there is none.
        var noLocal = item && item.LocalTrailerCount === 0 && item.Type !== 'Season' && item.Type !== 'Episode';
        if ((remote || noLocal) && !mb.CONFIG.preferLocalTrailers && !mb.CONFIG.onlyLocalTrailers) {
          return Promise.resolve(null);
        }
        return findLocal.apply(this, arguments);
      };
    }
    wrap();

    // Lists for the pages not opened yet, one at a time and well spaced, so that even their first visit does not wait.
    function fillOneList(pages) {
      var next = pages.shift();
      if (!next) {
        return;
      }
      if (read(next.Id) || document.hidden) {
        return setTimeout(fillOneList, 500, pages);
      }
      window.ApiClient.getJSON(window.ApiClient.getUrl('Items', {
        IncludeItemTypes: 'Movie,Series', Recursive: true, hasOverview: true, imageTypes: 'Logo,Backdrop', sortBy: 'Random', isPlayed: false,
        enableUserData: true, EnableImages: false, parentId: next.Id, Limit: next.CollectionType === 'movies' || next.CollectionType === 'tvshows' ? 15 : 30
      })).then(function (found) {
        save(next.Id, (found.Items || []).map(function (item) {
          return item.Id;
        }));
      }).finally(function () {
        setTimeout(fillOneList, FILL_GAP, pages);
      });
    }

    function startFilling() {
      var client = window.ApiClient;
      if (!client || !client.getCurrentUserId || !client.getCurrentUserId()) {
        return setTimeout(startFilling, FILL_START);
      }
      Promise.all([
        client.getJSON(client.getUrl('Users/' + client.getCurrentUserId() + '/Views')),
        client.getJSON(client.getUrl('Items', { userId: client.getCurrentUserId(), IncludeItemTypes: 'BoxSet', Recursive: true, EnableImages: false }))
      ]).then(function (answers) {
        var libraries = (answers[0].Items || []).filter(function (view) {
          return view.CollectionType !== 'boxsets' && view.CollectionType !== 'playlists';
        });
        fillOneList(libraries.concat(answers[1].Items || []));
      }, function () { /* the next load of the site tries again */ });
    }
    setTimeout(startFilling, FILL_START);
  })();

  /*
   * Each neighbour slide opens a YouTube player, the heaviest work of a page, right when its rows are loading. They wait for the
   * page to settle; the slide on screen does not depend on them.
   */
  (function neighboursWait() {
    var WAIT = 4000;
    var timer = null;
    function wrap() {
      var manager = window.mediaBarEnhanced && window.mediaBarEnhanced.SlideshowManager;
      if (!manager) {
        return setTimeout(wrap, 50);
      }
      var preload = manager.preloadAdjacentSlides;
      manager.preloadAdjacentSlides = function (index) {
        clearTimeout(timer);
        timer = setTimeout(function () {
          preload.call(manager, window.mediaBarEnhanced.STATE.slideshow.currentSlideIndex);
        }, WAIT);
      };
    }
    wrap();
  })();

  (function changeSlidesWithThePage() {
    var loadedFor = null;
    var CHANGING = 'encore-banner-changing';
    var style = document.createElement('style');
    style.textContent = '#slides-container.' + CHANGING + '>*{visibility:hidden!important}';
    document.head.appendChild(style);

    function sourceOf(hash) {
      var page = pageOf(hash);
      return page ? page.parent : '';
    }

    // Nothing of the old page stays while the new one loads: slides, dots, timer and trailer go at the moment the page changes.
    function leaveOldSlides() {
      var mb = window.mediaBarEnhanced;
      var hash = window.location.hash;
      var container = document.getElementById('slides-container');
      var current = loadedFor !== null ? loadedFor : window.mediaBarEncoreAskedFor; // still on the first load: the page it is for
      if (!mb || !mb.STATE || !container || current === undefined || (!pageOf(hash) && hash !== '#/home' && hash !== '#/home.html')) {
        return;
      }
      if (sourceOf(hash) === current || container.classList.contains(CHANGING)) {
        return;
      }
      container.classList.add(CHANGING);
      var slideshow = mb.STATE.slideshow;
      if (slideshow.slideInterval) {
        slideshow.slideInterval.stop();
      }
      mb.SlideshowManager.stopAllPlayback();
    }
    window.addEventListener('hashchange', leaveOldSlides);

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
      var hash = window.location.hash;
      // The banner comes back with the first slide of this page, without waiting for the rest of the load.
      var shown = document.querySelector('#slides-container.' + CHANGING + ' .slide.active');
      if (shown && mb && mb.STATE && loadedFor === sourceOf(hash) && mb.STATE.slideshow.itemIds.indexOf(shown.dataset.itemId) !== -1) {
        shown.closest('#slides-container').classList.remove(CHANGING);
      }
      if (!mb || !mb.STATE || !mb.STATE.slideshow.initialLoadComplete || mb.STATE.slideshow.isLoading) {
        return;
      }
      if (loadedFor === null) {
        loadedFor = window.mediaBarEncoreAskedFor !== undefined ? window.mediaBarEncoreAskedFor : sourceOf(hash); // the page that first load was for; the user may have moved on since
      }
      if (!pageOf(hash) && hash !== '#/home' && hash !== '#/home.html') {
        return; // another page: the slides only change when one of these opens
      }
      var source = sourceOf(hash);
      if (source !== loadedFor) {
        leaveOldSlides();
        swap(source);
      } else {
        var container = document.getElementById('slides-container');
        if (container) {
          container.classList.remove(CHANGING); // the new page's first slide is ready, or it has none
        }
      }
    }, 100);
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
      if (!container || container.classList.contains('media-bar-hidden')) {
        return false; // hidden by the Media Bar itself (other page, video player open): it handles playback there
      }
      // A hidden window (another desktop, another tab) keeps its layout, so this still holds there: hiding it must not release the pause.
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
