import { describe, expect, it } from 'vitest';

import {
  getPermissionDisplayName,
  hasKnownPermissionDisplayKey,
  listKnownPermissionDisplayKeys,
} from '../src/analyzer/privacy/permissionDisplay.js';

const REPORT_AND_GROUNDTRUTH_EXTRAS = [
  'OHOS.PERMISSION.ACCESS_DEVICE_CERTIFICATE',
  'OHOS.PERMISSION.ACCESS_HEALTH_DATA',
  'OHOS.PERMISSION.ACCESS_NETWORK_STATE',
  'OHOS.PERMISSION.DEVICE_UNIQUE_IDENTIFICATION',
  'OHOS.PERMISSION.DISTRIBUTED_DEVICE_CERTIFICATION',
  'OHOS.PERMISSION.HEALTHKIT_DATA_READ',
  'OHOS.PERMISSION.HEALTHKIT_WRITE',
  'OHOS.PERMISSION.HIVIEW_PERMISSION',
  'OHOS.PERMISSION.INTENT_SEND',
  'OHOS.PERMISSION.LOG',
  'OHOS.PERMISSION.READ_DEVICE_INFO',
  'OHOS.PERMISSION.START_ABILITY_FROM_BACKGROUND',
] as const;

describe('permission display names', () => {
  it('covers the 686 known permissions and includes report/groundtruth extras', () => {
    const expected = listKnownPermissionDisplayKeys();
    expect(expected).toHaveLength(686);

    for (const permissionName of REPORT_AND_GROUNDTRUTH_EXTRAS) {
      expect(hasKnownPermissionDisplayKey(permissionName)).toBe(true);
      expect(getPermissionDisplayName(permissionName)).not.toBe('');
    }
  });

  it('uses curated chinese labels for common report permissions', () => {
    expect(getPermissionDisplayName('ohos.permission.INTERNET')).toBe('网络访问权限');
    expect(getPermissionDisplayName('ohos.permission.CAMERA')).toBe('相机权限');
    expect(getPermissionDisplayName('ohos.permission.GET_NETWORK_INFO')).toBe('获取网络信息权限');
    expect(getPermissionDisplayName('ohos.permission.START_ABILITY_FROM_BACKGROUND')).toBe('后台启动能力权限');
  });
});
