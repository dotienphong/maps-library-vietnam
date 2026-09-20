import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  IOS_PROFILE_MIN_HOURS,
  iosWorkspace,
  profileCoversBundleId,
  provisioningDecision,
  provisioningProfilesDir,
  provisioningWarmupArgs,
  trustReminder,
} from './ios-provisioning.mjs';

/**
 * Sự cố thật 20/09/2026: `pnpm release:ios` chết với `No profiles for 'vn.mapslibvn.demo' were
 * found … pass -allowProvisioningUpdates`. Hồ sơ ký của Apple ID cá nhân (free personal team) sống
 * đúng 7 ngày — cái tạo 13/09 hết hạn đúng 20/09 và bị Xcode dọn, thư mục hồ sơ rỗng. Chứng chỉ
 * trong keychain vẫn hợp lệ, nên đi tìm lỗi ở chứng chỉ là lạc hướng.
 *
 * Expo CLI KHÔNG tự chữa được: `ensureDeviceIsCodeSignedForDeploymentAsync()`
 * (`run/ios/codeSigning/configureCodeSigning.js`) trả `null` khi pbxproj ĐÃ có `DEVELOPMENT_TEAM`,
 * và `run/ios/XcodeBuild.js` chỉ thêm `-allowProvisioningUpdates` khi hàm đó trả team id. Build
 * đầu tiên tự ghi `DEVELOPMENT_TEAM` vào pbxproj → từ lần hai trở đi cờ đó không bao giờ được
 * truyền nữa. `expo run:ios` cũng không có cờ passthrough nào xuống `xcodebuild`.
 *
 * Module này vá bằng cách tự chạy một lượt `xcodebuild … -allowProvisioningUpdates` TRƯỚC khi gọi
 * Expo, và chỉ chạy khi hồ sơ thật sự thiếu/sắp hết hạn.
 */

describe('provisioningProfilesDir', () => {
  it('trỏ vào thư mục của Xcode 16+ chứ không phải thư mục MobileDevice cũ', () => {
    // Xcode 26.6 chỉ đọc UserData/Provisioning Profiles; ~/Library/MobileDevice/Provisioning
    // Profiles là chỗ cũ, trên máy PHONG chỉ còn sót một hồ sơ macOS từ 17/06 nên nhìn vào đó sẽ
    // kết luận sai là "vẫn còn hồ sơ".
    expect(provisioningProfilesDir('/Users/x')).toBe(
      '/Users/x/Library/Developer/Xcode/UserData/Provisioning Profiles',
    );
  });
});

describe('profileCoversBundleId', () => {
  it('khớp đúng bundle id sau tiền tố team', () => {
    expect(profileCoversBundleId('H7WM3795WU.vn.mapslibvn.demo', 'vn.mapslibvn.demo')).toBe(true);
  });

  it('không khớp bundle id khác', () => {
    expect(profileCoversBundleId('H7WM3795WU.vn.mapslibvn.khac', 'vn.mapslibvn.demo')).toBe(false);
  });

  it('hồ sơ wildcard toàn team (team.*) phủ mọi bundle id', () => {
    expect(profileCoversBundleId('H7WM3795WU.*', 'vn.mapslibvn.demo')).toBe(true);
  });

  it('wildcard theo tiền tố phủ bundle id cùng tiền tố, không phủ tiền tố khác', () => {
    expect(profileCoversBundleId('H7WM3795WU.vn.mapslibvn.*', 'vn.mapslibvn.demo')).toBe(true);
    expect(profileCoversBundleId('H7WM3795WU.vn.khac.*', 'vn.mapslibvn.demo')).toBe(false);
  });

  it('chuỗi không có dấu chấm (hỏng) → không khớp, không ném', () => {
    expect(profileCoversBundleId('H7WM3795WU', 'vn.mapslibvn.demo')).toBe(false);
  });
});

describe('provisioningDecision — quyết định thuần, không I/O', () => {
  const bundleId = 'vn.mapslibvn.demo';
  const now = new Date('2026-09-20T08:00:00Z');
  /** @param {string} expiresAt @param {string} [appId] */
  const profile = (expiresAt, appId = `H7WM3795WU.${bundleId}`) => ({
    file: `${expiresAt}.mobileprovision`,
    applicationIdentifier: appId,
    expiresAt,
  });

  it('thư mục hồ sơ rỗng → phải hâm nóng (đúng ca gặp thật 20/09)', () => {
    const d = provisioningDecision({ profiles: [], bundleId, now });
    expect(d.warmup).toBe(true);
    expect(d.reason).toContain(bundleId);
  });

  it('chỉ có hồ sơ của bundle id khác → vẫn phải hâm nóng', () => {
    const d = provisioningDecision({
      profiles: [profile('2026-12-01T00:00:00Z', 'H7WM3795WU.vn.khac.app')],
      bundleId,
      now,
    });
    expect(d.warmup).toBe(true);
  });

  it('hồ sơ đã hết hạn → hâm nóng, lý do nêu ngày hết hạn', () => {
    const d = provisioningDecision({ profiles: [profile('2026-09-19T00:00:00Z')], bundleId, now });
    expect(d.warmup).toBe(true);
    expect(d.reason).toContain('2026-09-19');
  });

  it('còn hạn nhưng dưới ngưỡng → hâm nóng trước, không để chết giữa buổi thử máy', () => {
    // Hết hạn sau 5 giờ nữa: build xong vẫn cài được, nhưng lần chạy kế trong ngày sẽ chết.
    const d = provisioningDecision({ profiles: [profile('2026-09-20T13:00:00Z')], bundleId, now });
    expect(d.warmup).toBe(true);
  });

  it('còn hạn dài → KHÔNG hâm nóng (không làm chậm lượt release bình thường)', () => {
    const d = provisioningDecision({ profiles: [profile('2026-09-27T07:38:36Z')], bundleId, now });
    expect(d.warmup).toBe(false);
    expect(d.reason).toContain('2026-09-27');
  });

  it('nhiều hồ sơ cùng bundle id → lấy cái hạn xa nhất, không phải cái đầu danh sách', () => {
    const d = provisioningDecision({
      profiles: [profile('2026-09-19T00:00:00Z'), profile('2026-09-27T07:38:36Z')],
      bundleId,
      now,
    });
    expect(d.warmup).toBe(false);
  });

  it('hạn không đọc được → hâm nóng (thà chạy thừa còn hơn chết ở xcodebuild)', () => {
    const d = provisioningDecision({ profiles: [profile('không-phải-ngày')], bundleId, now });
    expect(d.warmup).toBe(true);
  });

  it('ngưỡng mặc định là 24 giờ và có thể ghi đè', () => {
    expect(IOS_PROFILE_MIN_HOURS).toBe(24);
    const profiles = [profile('2026-09-21T12:00:00Z')]; // còn 28 giờ
    expect(provisioningDecision({ profiles, bundleId, now }).warmup).toBe(false);
    expect(provisioningDecision({ profiles, bundleId, now, minHoursLeft: 48 }).warmup).toBe(true);
  });
});

describe('provisioningWarmupArgs', () => {
  it('có đủ hai cờ mà chính thông báo lỗi của xcodebuild đòi', () => {
    const args = provisioningWarmupArgs({
      workspace: 'MapsLibVNDemo.xcworkspace',
      scheme: 'MapsLibVNDemo',
      configuration: 'Release',
      destinationId: '600EE67B-0B24-5249-BDFC-DAA46353D9AC',
    });
    expect(args).toContain('-allowProvisioningUpdates');
    // Máy chưa từng đăng ký với team thì chỉ -allowProvisioningUpdates là chưa đủ.
    expect(args).toContain('-allowProvisioningDeviceRegistration');
  });

  it('nhắm đúng máy thật bằng id, và kết thúc bằng hành động build', () => {
    const args = provisioningWarmupArgs({
      workspace: 'W.xcworkspace',
      scheme: 'S',
      configuration: 'Release',
      destinationId: 'UDID-1',
    });
    expect(args).toContain('id=UDID-1');
    // `build` phải là tham số CUỐI: xcodebuild đọc hành động sau các tuỳ chọn.
    expect(args[args.length - 1]).toBe('build');
  });

  it('dùng đúng configuration được truyền vào', () => {
    const args = provisioningWarmupArgs({
      workspace: 'W.xcworkspace',
      scheme: 'S',
      configuration: 'Debug',
      destinationId: 'UDID-1',
    });
    expect(args[args.indexOf('-configuration') + 1]).toBe('Debug');
  });
});

describe('iosWorkspace', () => {
  /** @type {string} */
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mlv-ios-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('tìm được .xcworkspace và suy ra scheme từ tên file', () => {
    mkdirSync(join(dir, 'ios', 'MapsLibVNDemo.xcworkspace'), { recursive: true });
    expect(iosWorkspace(dir)).toEqual({
      workspace: 'MapsLibVNDemo.xcworkspace',
      scheme: 'MapsLibVNDemo',
    });
  });

  it('bỏ qua .xcodeproj — CocoaPods bắt buộc build qua workspace', () => {
    mkdirSync(join(dir, 'ios', 'MapsLibVNDemo.xcodeproj'), { recursive: true });
    mkdirSync(join(dir, 'ios', 'MapsLibVNDemo.xcworkspace'), { recursive: true });
    expect(iosWorkspace(dir).workspace).toBe('MapsLibVNDemo.xcworkspace');
  });

  it('chưa prebuild (không có thư mục ios) → ném lỗi nói rõ phải prebuild', () => {
    expect(() => iosWorkspace(dir)).toThrow(/prebuild/i);
  });

  it('có thư mục ios nhưng không có workspace → ném lỗi', () => {
    mkdirSync(join(dir, 'ios'), { recursive: true });
    writeFileSync(join(dir, 'ios', 'Podfile'), '');
    expect(() => iosWorkspace(dir)).toThrow(/xcworkspace/);
  });
});

describe('trustReminder', () => {
  it('nêu đúng đường đi trong Cài đặt của iPhone và tên app', () => {
    // Hồ sơ mới ⇒ iPhone có thể chặn MỞ app (FBSOpenApplicationErrorDomain error 3) dù đã cài
    // xong; không ai đoán ra bước này nếu script không nói.
    const msg = trustReminder('vn.mapslibvn.demo');
    expect(msg).toContain('VPN & Quản lý thiết bị');
    expect(msg).toContain('vn.mapslibvn.demo');
  });

  it('nói ở thể điều kiện, không khẳng định chắc chắn sẽ bị chặn', () => {
    // Cái iPhone tin cậy là CHỨNG CHỈ (sống 1 năm — đo 20/09/2026: hạn 20/07/2027), không phải hồ
    // sơ ký (7 ngày). Bấm Tin cậy một lần là đủ cho các lượt xin hồ sơ mới về sau, nên lời nhắc
    // khẳng định "sẽ bị chặn" là SAI và sẽ bắt PHONG làm thừa một bước mỗi tuần.
    const msg = trustReminder('vn.mapslibvn.demo');
    expect(msg).toMatch(/Nếu/);
    expect(msg).not.toMatch(/sẽ từ chối/);
  });
});
