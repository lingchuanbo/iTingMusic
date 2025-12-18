import { Howl } from 'howler'
import { usePlayerStore } from '@/store/player'

class AudioPlayer {
  private howl: Howl | null = null
  private rafId: number | null = null

  play(url: string) {
    this.destroy()
    const store = usePlayerStore()

    this.howl = new Howl({
      src: [url],
      html5: true,
      volume: store.volume,
      onplay: () => {
        store.isPlaying = true
        this.startProgress()
      },
      onpause: () => {
        store.isPlaying = false
      },
      onend: () => {
        if (store.playMode === 'single') {
          this.howl?.play()
        } else {
          store.nextTrack()
        }
      },
      onload: () => {
        store.setDuration(this.howl?.duration() || 0)
      }
    })
    this.howl.play()
  }

  toggle() {
    if (!this.howl) return
    if (this.howl.playing()) {
      this.howl.pause()
    } else {
      this.howl.play()
    }
  }

  seek(time: number) {
    this.howl?.seek(time)
  }

  setVolume(v: number) {
    this.howl?.volume(v)
  }

  private startProgress() {
    const store = usePlayerStore()
    const update = () => {
      if (this.howl?.playing()) {
        store.setCurrentTime(this.howl.seek() as number)
        this.rafId = requestAnimationFrame(update)
      }
    }
    update()
  }

  destroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.howl?.unload()
    this.howl = null
  }
}

export const audioPlayer = new AudioPlayer()
