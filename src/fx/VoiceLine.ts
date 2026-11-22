/**
 * Plays one optional voice clip with an HTMLAudioElement: tries the candidate URLs in order
 * (see `voiceUrlFor`) and stays silent when none loads or the browser refuses playback.
 * `stop()` silences it at once; call it when the card closes and on scene shutdown.
 */
export class VoiceLine {
  private audio: HTMLAudioElement | null = null;
  private token = 0;

  play(urls: readonly string[], volume: number): void {
    this.stop();
    if (volume <= 0 || urls.length === 0 || typeof Audio === 'undefined') return;
    const token = ++this.token;
    this.tryUrl(urls, 0, Math.min(1, Math.max(0, volume)), token);
  }

  stop(): void {
    this.token++;
    const a = this.audio;
    this.audio = null;
    if (!a) return;
    a.onerror = null;
    try {
      a.pause();
      a.removeAttribute('src');
      a.load();
    } catch {
      // a clip that cannot be stopped is simply dropped
    }
  }

  private tryUrl(urls: readonly string[], index: number, volume: number, token: number): void {
    if (token !== this.token || index >= urls.length) return;
    let audio: HTMLAudioElement;
    try {
      audio = new Audio();
    } catch {
      return;
    }
    this.audio = audio;
    audio.preload = 'auto';
    audio.volume = volume;
    audio.onerror = (): void => {
      audio.onerror = null;
      if (token !== this.token) return;
      this.audio = null;
      this.tryUrl(urls, index + 1, volume, token);
    };
    audio.src = urls[index];
    const started = audio.play();
    // Autoplay refusal or a missing file: stay silent (the error handler moves to the next URL).
    if (started) started.catch(() => undefined);
  }
}
