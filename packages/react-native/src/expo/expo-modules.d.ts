// Kiểu ambient TỐI THIỂU cho năm gói Expo mà entry `/expo` gọi. Không cài các gói này vào pnpm
// workspace (quyết định M6: Expo nằm ngoài workspace). App nhúng dùng kiểu thật của gói đã cài;
// API công khai của entry không lộ kiểu nào ở đây. Đối chiếu với expo-location 57.0.15,
// expo-task-manager 57.0.15, expo-speech 57.0.2, expo-audio 57.0.4, expo-keep-awake 57.0.1.

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
}

declare module 'expo-keep-awake' {
  export function activateKeepAwakeAsync(tag?: string): Promise<void>;
  export function deactivateKeepAwake(tag?: string): Promise<void>;
}
