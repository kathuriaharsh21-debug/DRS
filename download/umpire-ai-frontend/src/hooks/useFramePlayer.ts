import { useState, useCallback, useRef, useEffect, type RefObject } from 'react';
import { DEFAULT_FPS } from '../lib/constants';

interface UseFramePlayerReturn {
  currentFrame: number;
  currentTime: number;
  isPlaying: boolean;
  playbackSpeed: number;
  totalFrames: number;
  fps: number;
  duration: number;
  stepForward: () => void;
  stepBackward: () => void;
  goToFrame: (frame: number) => void;
  goToTime: (time: number) => void;
  togglePlay: () => void;
  setPlaybackSpeed: (speed: number) => void;
  setLoopStart: (frame: number) => void;
  setLoopEnd: (frame: number) => void;
  clearLoop: () => void;
  loopStart: number | null;
  loopEnd: number | null;
}

export function useFramePlayer(
  videoRef: RefObject<HTMLVideoElement | null>,
  fps: number = DEFAULT_FPS,
): UseFramePlayerReturn {
  const [currentFrame, setCurrentFrame] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeedState] = useState(1);
  const [totalFrames, setTotalFrames] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loopStart, setLoopStart] = useState<number | null>(null);
  const [loopEnd, setLoopEnd] = useState<number | null>(null);

  const rafRef = useRef<number | null>(null);
  const loopStartRef = useRef<number | null>(null);
  const loopEndRef = useRef<number | null>(null);

  // Keep refs in sync
  useEffect(() => {
    loopStartRef.current = loopStart;
  }, [loopStart]);

  useEffect(() => {
    loopEndRef.current = loopEnd;
  }, [loopEnd]);

  const frameDuration = 1 / fps;

  const updateFrameFromTime = useCallback(
    (time: number) => {
      const frame = Math.floor(time * fps);
      setCurrentTime(time);
      setCurrentFrame(Math.max(0, frame));
    },
    [fps],
  );

  // Duration tracking
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoaded = () => {
      const dur = video.duration;
      if (dur && isFinite(dur)) {
        setDuration(dur);
        setTotalFrames(Math.floor(dur * fps));
      }
    };

    video.addEventListener('loadedmetadata', handleLoaded);
    if (video.duration && isFinite(video.duration)) {
      handleLoaded();
    }

    return () => {
      video.removeEventListener('loadedmetadata', handleLoaded);
    };
  }, [videoRef, fps]);

  // RAF loop for frame tracking
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const tick = () => {
      if (!video.paused && !video.ended) {
        updateFrameFromTime(video.currentTime);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [videoRef, updateFrameFromTime]);

  // Loop boundary enforcement
  useEffect(() => {
    const video = videoRef.current;
    if (!video || loopStartRef.current === null) return;

    const handleTimeUpdate = () => {
      if (loopEndRef.current !== null && video.currentTime >= loopEndRef.current / fps) {
        video.currentTime = loopStartRef.current! / fps;
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => video.removeEventListener('timeupdate', handleTimeUpdate);
  }, [videoRef, fps]);

  const stepForward = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const newTime = Math.min(video.duration, video.currentTime + frameDuration);
    video.currentTime = newTime;
    updateFrameFromTime(newTime);
  }, [videoRef, frameDuration, updateFrameFromTime]);

  const stepBackward = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const newTime = Math.max(0, video.currentTime - frameDuration);
    video.currentTime = newTime;
    updateFrameFromTime(newTime);
  }, [videoRef, frameDuration, updateFrameFromTime]);

  const goToFrame = useCallback(
    (frame: number) => {
      const video = videoRef.current;
      if (!video) return;

      const clampedFrame = Math.max(0, Math.min(frame, totalFrames));
      const newTime = clampedFrame / fps;
      video.currentTime = newTime;
      updateFrameFromTime(newTime);
    },
    [videoRef, fps, totalFrames, updateFrameFromTime],
  );

  const goToTime = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (!video) return;

      const clampedTime = Math.max(0, Math.min(time, duration));
      video.currentTime = clampedTime;
      updateFrameFromTime(clampedTime);
    },
    [videoRef, duration, updateFrameFromTime],
  );

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      if (loopStartRef.current !== null) {
        video.currentTime = loopStartRef.current / fps;
      }
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, [videoRef, fps]);

  const setPlaybackSpeed = useCallback((speed: number) => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = speed;
    }
    setPlaybackSpeedState(speed);
  }, [videoRef]);

  const handleSetLoopStart = useCallback(
    (frame: number) => {
      setLoopStart(frame);
      loopStartRef.current = frame;
    },
    [],
  );

  const handleSetLoopEnd = useCallback(
    (frame: number) => {
      setLoopEnd(frame);
      loopEndRef.current = frame;
    },
    [],
  );

  const clearLoop = useCallback(() => {
    setLoopStart(null);
    setLoopEnd(null);
    loopStartRef.current = null;
    loopEndRef.current = null;
  }, []);

  // Play/pause sync with video element events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handleEnded);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handleEnded);
    };
  }, [videoRef]);

  return {
    currentFrame,
    currentTime,
    isPlaying,
    playbackSpeed,
    totalFrames,
    fps,
    duration,
    stepForward,
    stepBackward,
    goToFrame,
    goToTime,
    togglePlay,
    setPlaybackSpeed,
    setLoopStart: handleSetLoopStart,
    setLoopEnd: handleSetLoopEnd,
    clearLoop,
    loopStart,
    loopEnd,
  };
}
