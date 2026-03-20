declare global {
  interface Window {
    io?: () => unknown;
    __playerLog?: (level: string, message: string, details?: unknown) => void;
    __overlayBuildToken?: string;
    onYouTubeIframeAPIReady?: () => void;
    YT?: typeof YT;
    SC?: typeof SC;
  }

  namespace YT {
    type PlayerState = number;

    interface PlayerOptions {
      videoId?: string;
      width?: number | string;
      height?: number | string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: OnReadyEvent) => void;
        onStateChange?: (event: OnStateChangeEvent) => void;
        onError?: (event: OnErrorEvent) => void;
      };
    }

    interface Player {
      cueVideoById(videoId: string): void;
      loadVideoById(videoId: string): void;
      stopVideo(): void;
      pauseVideo(): void;
      playVideo(): void;
      setVolume(volume: number): void;
      getDuration(): number;
      getCurrentTime(): number;
      destroy(): void;
    }

    interface OnReadyEvent {
      target: Player;
    }

    interface OnStateChangeEvent {
      data: PlayerState;
      target: Player;
    }

    interface OnErrorEvent {
      data: number;
      target: Player;
    }

    const PlayerState: {
      UNSTARTED: PlayerState;
      ENDED: PlayerState;
      PLAYING: PlayerState;
      PAUSED: PlayerState;
      BUFFERING: PlayerState;
      CUED: PlayerState;
    };

    const Player: {
      new (elementId: string | HTMLElement, options?: PlayerOptions): Player;
    };
  }

  namespace SC {
    interface WidgetInstance {
      bind(eventName: string, handler: (...args: unknown[]) => void): void;
      unbind(eventName: string): void;
      load(url: string, options?: Record<string, unknown>): void;
      play(): void;
      pause(): void;
      seekTo(milliseconds: number): void;
      setVolume(volume: number): void;
      getDuration(callback: (duration: number) => void): void;
      getPosition(callback: (position: number) => void): void;
    }

    interface WidgetStatic {
      Events: Record<string, string>;
      (element: HTMLIFrameElement): WidgetInstance;
    }

    const Widget: WidgetStatic;
  }
}

export {};
