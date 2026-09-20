import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Giữ cho `pnpm release:ios` không chết mỗi 7 ngày vì hồ sơ ký (provisioning profile) hết hạn.
 *
 * Sự cố thật 20/09/2026: `xcodebuild` thoát mã 65 với
 *   `No profiles for 'vn.mapslibvn.demo' were found … pass -allowProvisioningUpdates`.
 * Hồ sơ của Apple ID cá nhân (free personal team) sống ĐÚNG 7 ngày — cái tạo 13/09 hết hạn đúng
 * 20/09, Xcode dọn nó đi và thư mục hồ sơ rỗng. Chứng chỉ trong keychain (`Apple Development: …`)
 * thì vẫn hợp lệ, nên "chứng chỉ còn, hồ sơ mất": đi soi chứng chỉ là lạc hướng.
 *
 * Vì sao Expo CLI không tự chữa được (đọc thẳng mã nguồn `@expo/cli` của Expo SDK 57):
 * `ensureDeviceIsCodeSignedForDeploymentAsync()` trong `run/ios/codeSigning/configureCodeSigning.js`
 * trả `null` ngay khi pbxproj ĐÃ có `DEVELOPMENT_TEAM`, và `run/ios/XcodeBuild.js` chỉ thêm
 * `-allowProvisioningUpdates` khi hàm đó trả về team id. Build ĐẦU TIÊN tự ghi `DEVELOPMENT_TEAM`
 * vào pbxproj → từ lần hai trở đi Expo chỉ in `› Auto signing app using team(s): …` rồi bỏ cờ.
 * Bẫy quẩn: build đầu tạo được hồ sơ, rồi tự khoá mất khả năng tạo lại. `expo run:ios` cũng không
 * nhận cờ passthrough nào xuống `xcodebuild` (xem danh sách cờ trong `run/ios/index.js`).
 *
 * Cách vá: TRƯỚC khi gọi Expo, tự chạy một lượt `xcodebuild … -allowProvisioningUpdates` để Xcode
 * xin hồ sơ mới từ Apple. Chỉ chạy khi hồ sơ thật sự thiếu/sắp hết hạn, nên lượt release bình
 * thường không chậm đi. Hồ sơ mới kéo theo một bước TAY trên iPhone — xem `trustReminder`.
 */

/** Ngưỡng hạn còn lại tối thiểu (giờ) để coi hồ sơ là dùng được mà không cần xin lại. */
export const IOS_PROFILE_MIN_HOURS = 24;

/**
 * Xcode 16+ (máy PHONG đang dùng Xcode 26.6) đọc hồ sơ ký ở đây. KHÔNG phải
 * `~/Library/MobileDevice/Provisioning Profiles` — thư mục cũ đó trên máy PHONG chỉ còn sót một
 * hồ sơ `.provisionprofile` của macOS từ 17/06, nhìn vào sẽ kết luận sai là "vẫn còn hồ sơ".
 * @param {string} home thư mục người dùng
 */
export function provisioningProfilesDir(home) {
  return `${home}/Library/Developer/Xcode/UserData/Provisioning Profiles`;
}

/**
 * Hồ sơ có phủ bundle id này không. Entitlement `application-identifier` có dạng
 * `<TEAM>.<bundle id>`, và có thể là wildcard (`<TEAM>.*` cho hồ sơ chung, hoặc `<TEAM>.vn.x.*`).
 * @param {string} applicationIdentifier
 * @param {string} bundleId
 */
export function profileCoversBundleId(applicationIdentifier, bundleId) {
  const dot = applicationIdentifier.indexOf('.');
  if (dot < 0) return false; // chuỗi hỏng/thiếu tiền tố team — coi như không phủ, không ném
  const pattern = applicationIdentifier.slice(dot + 1);
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) return bundleId.startsWith(pattern.slice(0, -1));
  return pattern === bundleId;
}

/**
 * Quyết định thuần — không đọc/ghi gì, để test được mà không cần hồ sơ thật trên máy.
 * @param {{
 *   profiles: { file: string, applicationIdentifier: string, expiresAt: string }[],
 *   bundleId: string,
 *   now: Date,
 *   minHoursLeft?: number,
 * }} input
 * @returns {{ warmup: boolean, reason: string }}
 */
export function provisioningDecision({ profiles, bundleId, now, minHoursLeft }) {
  const nguong = minHoursLeft ?? IOS_PROFILE_MIN_HOURS;
  const khop = profiles.filter((p) => profileCoversBundleId(p.applicationIdentifier, bundleId));
  if (khop.length === 0) {
    return { warmup: true, reason: `không có hồ sơ ký nào cho "${bundleId}"` };
  }
  // Lấy hồ sơ hạn XA NHẤT: Xcode giữ nhiều hồ sơ cùng bundle id (mỗi lần xin lại là một file mới),
  // cái đầu danh sách thường là cái cũ đã hết hạn.
  const moiNhat = khop.reduce((a, b) => (hanConLai(a, now) >= hanConLai(b, now) ? a : b));
  const gio = hanConLai(moiNhat, now);
  if (Number.isNaN(gio)) {
    return { warmup: true, reason: `không đọc được hạn của hồ sơ ${moiNhat.file}` };
  }
  if (gio <= 0) {
    return { warmup: true, reason: `hồ sơ ký đã hết hạn ${moiNhat.expiresAt}` };
  }
  if (gio < nguong) {
    return {
      warmup: true,
      reason: `hồ sơ ký chỉ còn ${Math.floor(gio)} giờ (hết hạn ${moiNhat.expiresAt})`,
    };
  }
  return {
    warmup: false,
    reason: `hồ sơ ký còn ${Math.floor(gio / 24)} ngày (hết hạn ${moiNhat.expiresAt})`,
  };
}

/** @param {{ expiresAt: string }} profile @param {Date} now @returns {number} số giờ còn lại */
function hanConLai(profile, now) {
  return (Date.parse(profile.expiresAt) - now.getTime()) / 3_600_000;
}

/**
 * Tham số `xcodebuild` cho lượt hâm nóng hồ sơ ký. Hai cờ dưới đây chính là thứ thông báo lỗi của
 * xcodebuild đòi, và là thứ Expo bỏ quên:
 * - `-allowProvisioningUpdates`: cho phép Xcode liên hệ Apple tạo/tải hồ sơ mới.
 * - `-allowProvisioningDeviceRegistration`: cho phép đăng ký máy thật vào team (cần khi cắm máy
 *   lần đầu; thiếu nó thì máy mới vẫn không có hồ sơ dù đã có cờ trên).
 * @param {{ workspace: string, scheme: string, configuration: string, destinationId: string }} input
 * @returns {string[]}
 */
export function provisioningWarmupArgs({ workspace, scheme, configuration, destinationId }) {
  return [
    '-workspace',
    workspace,
    '-scheme',
    scheme,
    '-configuration',
    configuration,
    '-destination',
    `id=${destinationId}`,
    '-allowProvisioningUpdates',
    '-allowProvisioningDeviceRegistration',
    // Hành động phải đứng CUỐI, sau mọi tuỳ chọn.
    'build',
  ];
}

/**
 * Tìm `.xcworkspace` trong thư mục native đã prebuild. Phải build qua workspace chứ không phải
 * `.xcodeproj`: app dùng CocoaPods, build thẳng project sẽ thiếu toàn bộ Pods.
 * @param {string} appDir thư mục app Expo (examples/embed-rn)
 * @returns {{ workspace: string, scheme: string }}
 */
export function iosWorkspace(appDir) {
  const iosDir = join(appDir, 'ios');
  if (!existsSync(iosDir)) {
    throw new Error(
      `Không thấy ${iosDir} — chưa prebuild. Chạy \`npx expo prebuild --clean\` trong ${appDir}.`,
    );
  }
  const workspace = readdirSync(iosDir).find((f) => f.endsWith('.xcworkspace'));
  if (!workspace) {
    throw new Error(`Không thấy file .xcworkspace nào trong ${iosDir} (CocoaPods chưa chạy?).`);
  }
  return { workspace, scheme: workspace.replace(/\.xcworkspace$/, '') };
}

/**
 * Lời nhắc bước TAY có thể cần sau khi có hồ sơ ký mới: iPhone từ chối MỞ app với
 * `FBSOpenApplicationErrorDomain error 3` ("profile has not been explicitly trusted by the user")
 * dù app đã cài xong — gặp thật 20/09/2026. Không ai đoán ra bước này nếu script không nói.
 *
 * Viết ở thể điều kiện ("nếu") chứ không khẳng định: cái iPhone tin cậy là CHỨNG CHỈ, không phải
 * hồ sơ. Chứng chỉ `Apple Development` sống 1 năm (đo 20/09/2026: hạn tới 20/07/2027) nên sau khi
 * bấm Tin cậy một lần thì các lượt xin hồ sơ mới hằng tuần thường không đòi bấm lại.
 * @param {string} bundleId
 */
export function trustReminder(bundleId) {
  return `Nếu iPhone từ chối MỞ app ("profile has not been explicitly trusted by the user"),
    tin cậy developer bằng tay MỘT lần: Cài đặt → Cài đặt chung → VPN & Quản lý thiết bị →
    chọn mục "Apple Development: …" → Tin cậy.
    (App "${bundleId}" vẫn được cài lên máy bình thường; chỉ riêng lần MỞ bị chặn. Cái được tin cậy
    là chứng chỉ — sống 1 năm — nên không phải bấm lại mỗi lần hồ sơ ký hết hạn 7 ngày.)`;
}

/**
 * Đọc một file `.mobileprovision`. File là CMS đã ký, phải bóc bằng `security cms -D` mới ra plist;
 * hai thuộc tính cần lấy đọc bằng `plutil -extract … raw` trên cùng một lần bóc đó.
 * @param {string} file đường dẫn đầy đủ
 * @returns {{ file: string, applicationIdentifier: string, expiresAt: string } | null} null nếu
 *   file hỏng/không đọc được — một file lỗi không được phép làm chết cả lệnh release.
 */
export function readProvisioningProfile(file) {
  try {
    const plist = execFileSync('security', ['cms', '-D', '-i', file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    /** @param {string} key */
    const lay = (key) =>
      execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', '-'], {
        encoding: 'utf8',
        input: plist,
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
    return {
      file,
      applicationIdentifier: lay('Entitlements.application-identifier'),
      expiresAt: lay('ExpirationDate'),
    };
  } catch {
    return null;
  }
}

/**
 * Mọi hồ sơ ký đọc được trong thư mục. Thư mục chưa tồn tại → mảng rỗng (đúng ca gặp thật: Xcode
 * vừa dọn hết hồ sơ hết hạn và tạo lại thư mục trống).
 * @param {string} dir
 * @returns {{ file: string, applicationIdentifier: string, expiresAt: string }[]}
 */
export function listProvisioningProfiles(dir) {
  if (!existsSync(dir)) return [];
  return (
    readdirSync(dir)
      .filter((f) => f.endsWith('.mobileprovision'))
      // `flatMap` + `?? []` thay cho `map().filter(p => p !== null)`: filter không thu hẹp được
      // kiểu `… | null` nên tsc báo lỗi ở chỗ gọi.
      .flatMap((f) => readProvisioningProfile(join(dir, f)) ?? [])
  );
}
