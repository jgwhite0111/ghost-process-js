// src/runtime/music.js — crossfading bgm.
//
// The Phaser version used a window.MUSIC_HANDLER singleton that owned
// the currently-playing track so crossfades could span scene
// boundaries (intro's track fades out while the next scene's track
// fades in). The same pattern works with HTMLAudioElement + a
// requestAnimationFrame volume ramp; we don't need Phaser's sound
// plugin for this.

class MusicHandler {
    constructor() {
        this.music = null;     // currently-fading-in (or steady-state) Audio
        this.fadingOut = null; // previous Audio element being faded to 0
        this.rampId = 0;       // monotonic id, used to cancel stale ramps
    }

    async play(filename, baseVolume = 0.7, fadeMs = 1200) {
        const audio = await window.Runtime.loadAudio(`assets/audio/${filename}`);
        // If a track is already playing, demote it to fadingOut so its
        // current playback position is preserved through the crossfade.
        if (this.music && this.music !== audio) {
            // If the same URL was already playing, set up crossfade to
            // itself so the new instance takes over without silence.
            this.fadingOut = this.music;
        }
        audio.volume = 0;
        try { await audio.play(); } catch (e) { /* autoplay-blocked elsewhere */ }
        this.music = audio;
        this._ramp(audio, baseVolume, fadeMs);
        if (this.fadingOut && this.fadingOut !== audio) {
            this._ramp(this.fadingOut, 0, fadeMs, /* onDone */ (a) => {
                try { a.pause(); a.currentTime = 0; } catch (e) {}
                if (this.fadingOut === a) this.fadingOut = null;
            });
        } else {
            this.fadingOut = null;
        }
    }

    _ramp(audio, target, ms, onDone) {
        const id = ++this.rampId;
        const startVol = audio.volume;
        const startTime = performance.now();
        const tick = () => {
            if (id !== this.rampId) return; // a newer ramp took over
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
        this._ramp(a, 0, fadeMs, (audio) => {
            try { audio.pause(); audio.currentTime = 0; } catch (e) {}
        });
    }
}

window.MusicHandler = new MusicHandler();
