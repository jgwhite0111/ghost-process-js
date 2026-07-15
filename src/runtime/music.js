// src/runtime/music.js — crossfading bgm with medley support.
//
// MusicHandler is the window.MUSIC_HANDLER singleton. It owns the
// currently-playing track so crossfades can span scene boundaries
// (intro's track fades out while the next scene's track fades in).
// Volume ramps use requestAnimationFrame over an HTMLAudioElement —
// no audio framework needed.
//
// Autoplay handling: most browsers block audio.play() before a user
// gesture. When that happens we register a one-shot global listener
// for the first click/keydown anywhere on the page and resume the
// audio then. The intro screen therefore has music the moment the
// player hits PRESS START — that click counts as the gesture, and
// the music has already been preloaded by the time it arrives.
//
// MEDLEY support: scenes can declare a `music` field as either a
// string (single track) or an ordered list of track objects. `fadeAt`
// is stored on each destination entry and is the delay, in seconds,
// before transitioning to it from its predecessor:
//
//   "music": "chase.mp3"          ← single track
//   "music": [                    ← ordered medley
//     { "file": "chase.mp3" },
//     { "file": "chase_b.mp3", "fadeAt": 35 },
//     { "file": "chase_c.mp3", "fadeAt": 42 }
//   ]
//
// If the first destination omits `fadeAt`, its delay is half the first
// track's known duration or 30 seconds. Later omissions retain the
// existing MEDLEY_HALF_FALLBACK + currentIndex * MEDLEY_HALF_FALLBACK
// delay. Every medley crossfade overlaps for 4 seconds. The destination
// becomes current, and progression continues while another entry exists.

const DEFAULT_FADE_MS = 4000;          // crossfade overlap duration
const MEDLEY_HALF_FALLBACK = 30;       // seconds — first unknown-duration and later-delay fallback

class MusicHandler {
    constructor() {
        this.music = null;     // currently-fading-in (or steady-state) Audio
        this.fadingOut = null; // most recent Audio element being faded to 0
        this._rampIdIn = 0;    // latest incoming-track ramp
        // Outgoing tracks can overlap during rapid transitions. Keep each
        // audio's cancellation id separate so fading out a newer track does
        // not orphan an older one before it reaches pause().
        this._rampIdsOut = new WeakMap();
        this._playId = 0;      // latest scene-level play request
        this._pendingResume = null; // Audio waiting for a user gesture
        // Medley state — only set during a multi-track scene. Each
        // scheduled destination fadeAt advances from the current track.
        this._medleyTimer = null;       // setTimeout id for the next crossfade
        this._medleyTracks = null;      // array of {file, fadeAt, volume?} for current scene
        this._medleyCurrentIndex = 0;   // which track in the medley is the steady-state
    }

    /**
     * Play music for a scene. Accepts either:
     *   - a string filename (single-track mode)
     *   - a list of track objects with `file` keys (medley mode)
     *
     * The two modes share the same first-track fade-in behaviour. Medley
     * mode schedules each destination using its `fadeAt` delay, then keeps
     * advancing while another ordered entry exists.
     *
     * @param {string|string[]} musicArg - filename OR track list
     * @param {number} baseVolume - 0..1 volume for the incoming track
     * @param {number} fadeMs - crossfade overlap duration in ms
     */
    async play(musicArg, baseVolume = 0.7, fadeMs = 1200) {
        const playId = ++this._playId;
        // Normalise to a list — a string input becomes a one-element
        // list so the rest of the code can stay simple.
        const tracks = this._normaliseMusicArg(musicArg);
        // Cancel any pending medley crossfade from the previous scene —
        // a scene transition supersedes the schedule.
        this._cancelMedley();
        // Cancel any in-flight resume listener — flush any pending
        // medley timer.
        if (this._pendingResume) {
            this._pendingResume = null;
            this._clearResumeListeners();
        }
        // Start the first track immediately using the existing single-
        // track path. Crossfades from a previous scene's music follow
        // the existing fadeMs (typically 1200ms).
        const started = await this._playOne(tracks[0].file, baseVolume, fadeMs, playId);
        // A newer scene can call play() while this request is awaiting a
        // cached audio load/play promise. Only the latest request may own
        // the medley schedule or become current music.
        if (!started || playId !== this._playId) return;
        this._medleyTracks = tracks;
        this._medleyCurrentIndex = 0;
        // If the scene has another track, schedule the first transition.
        if (tracks.length > 1) {
            this._scheduleMedleyCrossfade(tracks, baseVolume);
        }
    }

    /**
     * Convert string or single-object input to a normalised list.
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
     * Schedule the transition to the first destination entry. Its fadeAt
     * is the delay from the first track; when omitted, use half the first
     * track's decoded duration (when known) or MEDLEY_HALF_FALLBACK.
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
     * Decide the first destination's default delay when it omits fadeAt.
     * Uses the first track's decoded duration / 2 so the crossfade lands
     * halfway through its loop. Falls back to MEDLEY_HALF_FALLBACK if the
     * duration isn't known yet.
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
     * Crossfade from the current steady-state track to the next ordered
     * destination. The existing track becomes fadingOut; the destination
     * starts at volume 0 and ramps up over DEFAULT_FADE_MS.
     */
    async _crossfadeToNext() {
        const tracks = this._medleyTracks;
        if (!tracks || this._medleyCurrentIndex + 1 >= tracks.length) return;
        const playId = this._playId;
        const next = tracks[this._medleyCurrentIndex + 1];
        // Load the next track (cached after first preload), start at 0,
        // ramp up. We DON'T go through _playOne because we want the
        // bigger medley crossfade duration, not the scene-boundary one.
        const audio = await window.Runtime.loadAudio(`assets/audio/${next.file}`);
        if (playId !== this._playId || this._medleyTracks !== tracks) return;
        audio.volume = 0;
        let started = false;
        try {
            await audio.play();
            started = true;
        } catch (e) {
            if (playId !== this._playId || this._medleyTracks !== tracks) return;
            // Autoplay blocked mid-medley — queue a resume like _playOne does.
            this._queueResume(audio, next.volume ?? 0.7, DEFAULT_FADE_MS);
        }
        if (playId !== this._playId || this._medleyTracks !== tracks) {
            if (started && this.music !== audio) {
                try { audio.pause(); audio.currentTime = 0; } catch (e) {}
            }
            return;
        }
        // Promote current to fadingOut only after the async work confirms
        // this medley still belongs to the active scene.
        if (this.music) {
            this.fadingOut = this.music;
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
        // Continue the ordered medley whenever another destination exists.
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
     * Internal: play a single track with the standard fade-in path. Used
     * for both the first track of a medley and the single-string
     * API.
     */
    async _playOne(filename, baseVolume = 0.7, fadeMs = 1200, playId = this._playId) {
        const audio = await window.Runtime.loadAudio(`assets/audio/${filename}`);
        if (playId !== this._playId) return false;
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
        let started = false;
        try {
            await audio.play();
            started = true;
        } catch (e) {
            if (playId !== this._playId) return false;
            // Autoplay likely blocked. The audio element is ready,
            // readyState=4, just paused. Queue a one-shot resume on
            // the first user gesture — the intro screen's PRESS START
            // click (or any click/keydown) will trigger it.
            this._queueResume(audio, baseVolume, fadeMs);
        }
        if (playId !== this._playId) {
            if (started && this.music !== audio) {
                try { audio.pause(); audio.currentTime = 0; } catch (e) {}
            }
            return false;
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
        return true;
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
        const outgoing = direction === 'out';
        const id = outgoing
            ? (this._rampIdsOut.get(audio) || 0) + 1
            : ++this._rampIdIn;
        if (outgoing) this._rampIdsOut.set(audio, id);
        const startVol = audio.volume;
        const startTime = performance.now();
        const tick = () => {
            const currentId = outgoing ? this._rampIdsOut.get(audio) : this._rampIdIn;
            if (id !== currentId) return; // a newer ramp for this audio took over
            const t = Math.min(1, (performance.now() - startTime) / ms);
            audio.volume = startVol + (target - startVol) * t;
            if (t < 1) {
                requestAnimationFrame(tick);
            } else {
                if (outgoing) this._rampIdsOut.delete(audio);
                onDone && onDone(audio);
            }
        };
        requestAnimationFrame(tick);
    }

    stop(fadeMs = 600) {
        ++this._playId;
        // Cancelling the medley timer also invalidates a crossfade that is
        // currently awaiting loadAudio() or audio.play().
        this._cancelMedley();
        if (this._pendingResume) {
            this._pendingResume = null;
            this._clearResumeListeners();
        }
        if (!this.music) return;
        const a = this.music;
        this.music = null;
        this._ramp(a, 0, fadeMs, (audio) => {
            try { audio.pause(); audio.currentTime = 0; } catch (e) {}
        }, 'out');
    }
}

window.MusicHandler = new MusicHandler();