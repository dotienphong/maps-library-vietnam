/// <reference path="./expo-modules.d.ts" />
// Chỗ DUY NHẤT import Expo trong SDK: test mock file này (`vi.mock('./modules')`), tsup để external,
// Metro của app chỉ resolve khi app import `@mapslibvn/react-native/expo`.
import * as Audio from 'expo-audio';
import * as KeepAwake from 'expo-keep-awake';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import * as TaskManager from 'expo-task-manager';

export { Audio, KeepAwake, Location, Speech, TaskManager };
