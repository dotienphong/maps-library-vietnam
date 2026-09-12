import { defineNavigationTask } from '@mapslibvn/react-native/expo';
import { registerRootComponent } from 'expo';

import App from './App';

// Bắt buộc ở phạm vi toàn cục, trước khi đăng ký root: expo-task-manager giao vị trí nền cho SDK
// (spec C 6.1). Thiếu dòng này thì SDK rơi về tiền cảnh và báo backgroundUnavailable(task_not_defined).
defineNavigationTask();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
registerRootComponent(App);
