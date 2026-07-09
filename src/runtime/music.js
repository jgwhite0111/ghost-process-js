// src/runtime/music.js — crossfading bgm with medley support.
//
// The Phaser version used a window.MUSIC_HANDLER singleton that owned
// the currently-playing track so crossfades could span scene
// boundaries (intro's track fades out while the next scene's track
// fades in). The same pattern works with HTMLAudioElement + a
// requestAnimationFrame volume ramp; we don't need Phaser's sound
// plugin for that.
//
// Autoplay handling: most browsers block audio.play() before a user
// gesture. When that happens we register a one-shot global listener
// for the first click/keydown anywhere on the page and resume the
// audio then. This is what lets the intro screen actually have music
// without a "click to enable audio" splash — clicking the PRESS
// START hitbox counts as the gesture, and the music has already been
// preloaded by the time that click arrives.
//
// MEDLEY support: scenes can declare a `music` field as either a
// string (legacy single track) or a list of track objects with
// optional `fadeAt` overrides:
//
//   "music": "chase.mp3"          ← single track, legacy
//   "music": [                    ← medley, A → B with default fade
//     { "file": "chase.mp3" },
//     { "file": "chase_b.mp3" }
//   ]
//   "music": [                    ← medley with explicit fade time
//     { "file": "chase.mp3" },
//     { "file": "chase_b.mp3", "fadeAt": 35 }
//   ]
//
// The default `fadeAt` is halfway through A's track duration. The
// default crossfade overlap is 4 seconds — enough to feel like a
// medley transition, short enough that the B-side settles in cleanly.
// Both tracks loop independently; after the crossfade the B-side
// becomes the steady-state and loops on its own forever.

const DEFAULT_FADE_MS = 4000;          // crossfade overlap duration
const MEDLEY_HALF_FALLBACK = 30;       // seconds — used when A's duration isn't known yet

class MusicHandler {
    constructor() {
        this.music = null;     // currently-fading-in (or steady-state) Audio
        this.fadingOut = null; // previous Audio element being faded to 0
        this._rampIdIn = 0;    // monotonic id for incoming-track ramps
        this._rampIdOut = 0;   // monotonic id for outgoing-track ramps (separate counter!)
        this._pendingResume = null; // Audio waiting for a user gesture
        // Medley state — only set during a multi-track scene. When a
        // scheduled fadeAt fires, the crossfade from currentTrack to
        // nextTrack kicks off.
        this._medleyTimer = null;       // setTimeout id for the next crossfade
        this._medleyTracks = null;      // array of {file, fadeAt, volume?} for current scene
        this._medleyCurrentIndex = 0;   // which track in the medley is the steady-state
    }

    /**
     * Play music for a scene. Accepts either:
     *   - a string filename (legacy single-track mode)
     *   - a list of track objects with `file` keys (medley mode)
     *
     * The two modes share the same first-track fade-in behaviour; medley
     * mode additionally schedules a crossfade to track[1] at `fadeAt` (or
     * half of track[0]'s duration).
     *
     * @param {string|string[]} musicArg - filename OR track list
     * @param {number} baseVolume - 0..1 volume for the incoming track
     * @param {number} fadeMs - crossfade overlap duration in ms
     */
    async play(musicArg, baseVolume = 0.7, fadeMs = 1200) {
        // Normalise to a list — legacy string input becomes a one-element
        // list so the rest of the code can stay simple.
        const tracks = this._normaliseMusicArg(musicArg);
        // Cancel any pending medley crossfade from the previous scene —
        // a scene transition supersedes the schedule.
        this._cancelMedley();
        // Cancel any in-flight resume listener — same logic as before,
        // but now also flush any pending medley timer.
        if (this._pendingResume) {
            this._pendingResume = null;
            this._clearResumeListeners();
        }
        // Start the first track immediately using the existing single-
        // track path. Crossfades from a previous scene's music follow
        // the existing fadeMs (typically 1200ms).
        await this._playOne(tracks[0].file, baseVolume, fadeMs);
        this._medleyTracks = tracks;
        this._medleyCurrentIndex = 0;
        // If the scene has a second track, schedule the crossfade.
        if (tracks.length > 1) {
            this._scheduleMedleyCrossfade(tracks, baseVolume);
        }
    }

    /**
     * Convert legacy string or single-object input to a normalised list.
     * Accepts: "chase.mp3", {file: "chase.mp3"}, [{file: ...}, ...]
     */
    _normaliseMusicArg(musicArg) {
        if (typeof musicArg === 'string') {
            return [{ file: musicArg }];
        }
        if (musicArg && typeof musicArg === 'object' && !Array.isArray(musicArg)) {
            return [musicArg];
        }
        return musicArg;
    }

    /**
     * Schedule the medley's first crossfade from track[0] to track[1].
     * Uses the track[1].fadeAt if specified, otherwise defaults to half
     * of track[0]'s decoded duration (when known) or MEDLEY_HALF_FALLBACK.
     */
    _scheduleMedleyCrossfade(tracks, baseVolume) {
        const next = tracks[1];
        const fadeAtSeconds = next.fadeAt !== undefined
            ? next.fadeAt
            : this._defaultFadeAt(tracks[0].file);
        const fadeAtMs = Math.max(0, fadeAtSeconds * 1000);
        this._medleyTimer = setTimeout(() => {
            // If something else superseded us (scene change, manual play()),
            // this._medleyTracks may no longer match — bail.
            if (!this._medleyTracks || this._medleyCurrentIndex !== 0) return;
            this._crossfadeToNext();
        }, fadeAtMs);
    }

    /**
     * Decide a sensible default fadeAt when the B-side track doesn't
     * specify one. Uses the A-side's decoded duration / 2 so the
     * crossfade lands halfway through A's loop, near the bar boundary.
     * Falls back to MEDLEY_HALF_FALLBACK if the duration isn't known yet.
     */
    _defaultFadeAt(file) {
        try {
            const audio = window.Runtime.loadAudio(`assets/audio/${file}`);
            // loadAudio is async; the promise may not be resolved yet. If
            // we get a cached audio synchronously, we can read duration.
            const cached = window.Runtime?.getCachedAudio?.(`assets/audio/${file}`);
            if (cached && cached.duration && isFinite(cached.duration)) {
                return cached.duration / 2;
            }
        } catch (e) { /* fall through */ }
        return MEDLEY_HALF_FALLBACK;
    }

    /**
     * Crossfade from the current steady-state track to medleyTracks[1].
     * The existing track becomes fadingOut; the new track starts at
     * volume 0 and ramps up over DEFAULT_FADE_MS.
     */
    async _crossfadeToNext() {
        const tracks = this._medleyTracks;
        if (!tracks || this._medleyCurrentIndex + 1 >= tracks.length) return;
        const next = tracks[this._medleyCurrentIndex + 1];
        // Promote current to fadingOut so its position is preserved
        if (this.music) {
            this.fadingOut = this.music;
        }
        // Load the next track (cached after first preload), start at 0,
        // ramp up. We DON'T go through _playOne because we want the
        // bigger medley crossfade duration, not the scene-boundary one.
        const audio = await window.Runtime.loadAudio(`assets/audio/${next.file}`);
        audio.volume = 0;
        try {
            await audio.play();
        } catch (e) {
            // Autoplay blocked mid-medley — queue a resume like _playOne does.
            this._queueResume(audio, next.volume ?? 0.7, DEFAULT_FADE_MS);
        }
        this.music = audio;
        this._medleyCurrentIndex += 1;
        // Ramp down the old track, ramp up the new one — same duration
        // so they're symmetrical (a real medley moment where both play).
        this._ramp(this.fadingOut, 0, DEFAULT_FADE_MS, (a) => {
            try { a.pause(); a.currentTime = 0; } catch (e) {}
            if (this.fadingOut === a) this.fadingOut = null;
        }, 'out');
        if (!audio.paused || this._pendingResume !== audio) {
            this._ramp(audio, next.volume ?? 0.7, DEFAULT_FADE_MS, null, 'in');
        }
        // If there's a third track in the medley, schedule the next
        // crossfade. (Medleys with 3+ tracks are uncommon but supported.)
        const nextIndex = this._medleyCurrentIndex + 1;
        if (nextIndex < tracks.length) {
            const upcoming = tracks[nextIndex];
            const fadeAt = upcoming.fadeAt !== undefined
                ? upcoming.fadeAt
                : MEDLEY_HALF_FALLBACK + this._medleyCurrentIndex * MEDLEY_HALF_FALLBACK;
            this._medleyTimer = setTimeout(() => {
                if (!this._medleyTracks || this._medleyCurrentIndex !== nextIndex - 1) return;
                this._crossfadeToNext();
            }, fadeAt * 1000);
        }
    }

    /**
     * Cancel any pending medley crossfade timer. Called when a scene
     * change supersedes the current medley schedule.
     */
    _cancelMedley() {
        if (this._medleyTimer) {
            clearTimeout(this._medleyTimer);
            this._medleyTimer = null;
        }
        this._medleyTracks = null;
        this._medleyCurrentIndex = 0;
    }

    /**
     * Internal: play a single track with the legacy fade-in path. Used
     * for both the first track of a medley and the legacy single-string
     * API.
     */
    async _playOne(filename, baseVolume = 0.7, fadeMs = 1200) {
        const audio = await window.Runtime.loadAudio(`assets/audio/${filename}`);
        // If a track is already playing, demote it to fadingOut so its
        // current playback position is preserved through the crossfade.
        if (this.music && this.music !== audio) {
            // If the same URL was already playing, set up crossfade to
            // itself so the new instance takes over without silence.
            this.fadingOut = this.music;
        }
        // A new play() supersedes any autoplay-blocked pending resume.
        // If we don't clear it, clicking later (e.g. the next scene's
        // gesture) would resume the OLD track on top of the new one.
        if (this._pendingResume && this._pendingResume !== audio) {
            this._pendingResume = null;
            // Also clean up the listeners so they don't fire.
            // _queueResume uses anonymous handlers — easier to just
            // replace the listener with a noop clone via a marker.
            this._clearResumeListeners();
        }
        audio.volume = 0;
        try {
            await audio.play();
        } catch (e) {
            // Autoplay likely blocked. The audio element is ready,
            // readyState=4, just paused. Queue a one-shot resume on
            // the first user gesture — the intro screen's PRESS START
            // click (or any click/keydown) will trigger it.
            this._queueResume(audio, baseVolume, fadeMs);
        }
        this.music = audio;
        if (this.fadingOut && this.fadingOut !== audio) {
            this._ramp(this.fadingOut, 0, fadeMs, /* onDone */ (a) => {
                try { a.pause(); a.currentTime = 0; } catch (e) {}
                if (this.fadingOut === a) this.fadingOut = null;
            }, 'out');
        } else {
            this.fadingOut = null;
        }
        // If play() actually succeeded and we're fading in, run the ramp.
        if (!audio.paused || this._pendingResume !== audio) {
            this._ramp(audio, baseVolume, fadeMs, null, 'in');
        }
    }

    _queueResume(audio, baseVolume, fadeMs) {
        if (this._pendingResume === audio) return;
        // Clean up any prior resume listeners (we're replacing them).
        this._clearResumeListeners();
        this._pendingResume = audio;
        const resume = () => {
            // Clean up listeners so we don't resume on every subsequent click.
            this._clearResumeListeners();
            const target = this._pendingResume;
            this._pendingResume = null;
            if (!target) return;
            target.play().then(() => {
                // If the targeted audio is no longer the current track
                // (some other scene's music already played() and demoted
                // it to fadingOut in the meantime), don't ramp the old
                // track back up — let the fadeOut complete in silence.
                if (this.music === target) {
                    this._ramp(target, baseVolume, fadeMs, null, 'in');
                }
            }).catch(() => { /* still blocked — give up */ });
        };
        // capture: true so we fire even if the click hits the dialogue
        // box or another handler stops propagation.
        document.addEventListener('pointerdown', resume, true);
        document.addEventListener('keydown', resume, true);
        this._resumeHandler = resume;
    }

    _clearResumeListeners() {
        if (this._resumeHandler) {
            document.removeEventListener('pointerdown', this._resumeHandler, true);
            document.removeEventListener('keydown', this._resumeHandler, true);
            this._resumeHandler = null;
        }
    }

    _ramp(audio, target, ms, onDone, direction = 'in') {
        const counter = direction === 'out' ? '_rampIdOut' : '_rampIdIn';
        const id = ++this[counter];
        const startVol = audio.volume;
        const startTime = performance.now();
        const tick = () => {
            if (id !== this[counter]) return; // a newer ramp of the same direction took over
            const t = Math.min(1, (performance.now() - startTime) / ms);
            audio.volume = startVol + (target - startVol) * t;
            if (t < 1) {
                requestAnimationFrame(tick);
            } else {
                onDone && onDone(audio);
            }
        };
        requestAnimationFrame(tick);
    }

    stop(fadeMs = 600) {
        if (!this.music) return;
        const a = this.music;
        this.music = null;
        // Cancelling the medley timer prevents a crossfade from firing
        // after we've already been asked to stop.
        this._cancelMedley();
        this._ramp(a, 0, fadeMs, (audio) => {
            try { audio.pause(); audio.currentTime = 0; } catch (e) {}
        }, 'out');
    }
}

window.MusicHandler = new MusicHandler();