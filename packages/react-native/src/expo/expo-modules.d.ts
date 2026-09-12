// Kiểu ambient TỐI THIỂU cho sáu gói Expo mà entry `/expo` gọi. Không cài các gói này vào pnpm
// workspace (quyết định M6: Expo nằm ngoài workspace). App nhúng dùng kiểu thật của gói đã cài;
// API công khai của entry không lộ kiểu nào ở đây. Đối chiếu với expo-location 57.0.15,
// expo-task-manager 57.0.15, expo-speech 57.0.2, expo-audio 57.0.4, expo-keep-awake 57.0.1,
// expo-sensors 57.0.3.

declare module 'expo-location' {
  export interface LocationObjectCoords {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    heading: number | null;
    speed: number | null;
  }
  export interface LocationObject {
    coords: LocationObjectCoords;
    timestamp: number;
  }
  export interface LocationSubscription {
    remove(): void;
  }
  export interface PermissionResponse {
    granted: boolean;
    status: string;
  }
  export interface LocationOptions {
    accuracy?: number;
    timeInterval?: number;
    distanceInterval?: number;
  }
  export function requestForegroundPermissionsAsync(): Promise<PermissionResponse>;
  export function watchPositionAsync(
    options: LocationOptions,
    callback: (location: LocationObject) => void,
    errorHandler?: (reason: string) => void,
  ): Promise<LocationSubscription>;
  /** Mẫu la bàn của watchHeadingAsync: iOS CLHeading (đã trộn gyro), Android từ kế + gia tốc kế. */
  export interface LocationHeadingObject {
    /** Độ so với bắc thật; −1 khi chưa có vị trí để tính độ lệch từ. */
    trueHeading: number;
    magHeading: number;
    /** 0 = không tin, 1 thấp, 2 vừa, 3 cao (iOS: sai số > 50° / < 50° / < 35° / < 20°). */
    accuracy: number;
  }
  export function watchHeadingAsync(
    callback: (heading: LocationHeadingObject) => void,
    errorHandler?: (reason: string) => void,
  ): Promise<LocationSubscription>;
  export function startLocationUpdatesAsync(
    taskName: string,
    options?: Record<string, unknown>,
  ): Promise<void>;
  export function stopLocationUpdatesAsync(taskName: string): Promise<void>;
  export function hasStartedLocationUpdatesAsync(taskName: string): Promise<boolean>;
  export function isBackgroundLocationAvailableAsync(): Promise<boolean>;
}

declare module 'expo-task-manager' {
  export interface TaskManagerTaskBody<T = unknown> {
    data: T;
    error: { code: string | number; message: string } | null;
    executionInfo: {
      eventId: string;
      taskName: string;
      appState?: 'active' | 'background' | 'inactive';
    };
  }
  export function defineTask<T = unknown>(
    taskName: string,
    executor: (body: TaskManagerTaskBody<T>) => Promise<unknown> | unknown,
  ): void;
  export function isTaskDefined(taskName: string): boolean;
}

declare module 'expo-speech' {
  export interface SpeechOptions {
    language?: string;
    pitch?: number;
    rate?: number;
    volume?: number;
    voice?: string;
    onDone?: () => void;
    onStopped?: () => void;
    onError?: (error: Error) => void;
  }
  export interface Voice {
    identifier: string;
    name: string;
    quality: string;
    language: string;
  }
  export function speak(text: string, options?: SpeechOptions): void;
  export function stop(): Promise<void>;
  export function getAvailableVoicesAsync(): Promise<Voice[]>;
}

declare module 'expo-audio' {
  export interface AudioMode {
    playsInSilentMode: boolean;
    shouldPlayInBackground: boolean;
    interruptionMode: 'mixWithOthers' | 'doNotMix' | 'duckOthers';
    allowsRecording: boolean;
    shouldRouteThroughEarpiece: boolean;
  }
  export function setAudioModeAsync(mode: Partial<AudioMode>): Promise<void>;
  /**
   * Kích hoạt/ngừng phiên AVAudioSession — BẮT BUỘC ngoài `setAudioModeAsync` để giọng đọc phát
   * được khi app vào nền: `setAudioModeAsync` chỉ đặt category, không gọi `AVAudioSession.setActive`
   * (xác nhận trong mã nguồn expo-audio 57.0.5 `AudioModule.swift`, hàm `setAudioMode` so với
   * `setIsAudioActive`). Thiếu bước này là nguyên nhân im lặng hoàn toàn khi khoá màn hình iPhone
   * (phát hiện thực địa 12/09/2026).
   */
  export function setIsAudioActiveAsync(active: boolean): Promise<void>;
  export interface AudioMetadata {
    title?: string;
    artist?: string;
    albumTitle?: string;
    artworkUrl?: string;
  }
  export interface AudioLockScreenOptions {
    showSeekForward?: boolean;
    showSeekBackward?: boolean;
    isLiveStream?: boolean;
  }
  export interface AudioPlayer {
    loop: boolean;
    volume: number;
    play(): void;
    pause(): void;
    remove(): void;
    /**
     * Đăng ký (hoặc gỡ) player này làm phiên media "đang phát" chính thức của hệ điều hành —
     * trên Android đây là bước để có `MediaSessionService` (foreground service riêng, độc lập
     * với foreground service định vị) giữ tiến trình sống khi khoá màn hình; thiếu bước này,
     * app đứng yên hoàn toàn khi khoá máy dù đã có foreground service định vị (xác nhận thực
     * địa Android thật 12/09/2026: `serviceTypes=8` của vị trí vẫn còn nhưng JS/TTS không chạy
     * tiếp). Tài liệu expo-audio khuyến nghị `interruptionMode: 'doNotMix'` để hệ điều hành gán
     * đúng quyền điều khiển màn khoá cho player này.
     */
    setActiveForLockScreen(
      active: boolean,
      metadata?: AudioMetadata,
      options?: AudioLockScreenOptions,
    ): void;
  }
  export interface AudioPlayerOptions {
    keepAudioSessionActive?: boolean;
  }
  /** `source` chấp nhận `data:audio/*;base64,...` — expo-audio giải mã và ghi ra file tạm trên iOS. */
  export function createAudioPlayer(
    source?: string | { uri?: string } | null,
    options?: AudioPlayerOptions,
  ): AudioPlayer;
}

declare module 'expo-keep-awake' {
  export function activateKeepAwakeAsync(tag?: string): Promise<void>;
  export function deactivateKeepAwake(tag?: string): Promise<void>;
}

declare module 'expo-sensors' {
  export interface GyroscopeMeasurement {
    /** rad/s theo trục thiết bị (thuận tay phải, Z hướng ra khỏi màn hình). */
    x: number;
    y: number;
    z: number;
    /** GIÂY theo đồng hồ cảm biến — khác miền với Date.now(). */
    timestamp: number;
  }
  export interface SensorSubscription {
    remove(): void;
  }
  export const Gyroscope: {
    setUpdateInterval(intervalMs: number): void;
    addListener(listener: (measurement: GyroscopeMeasurement) => void): SensorSubscription;
    isAvailableAsync(): Promise<boolean>;
  };
}
