import { postJson } from '@/lib/fetcher';

export const xinMa = (email: string, turnstileToken: string) =>
  postJson<{ daGui: boolean }>('/v1/console/auth/otp/request', { email, turnstileToken });

export const xacThucMa = (email: string, code: string) =>
  postJson<{ onboarded: boolean }>('/v1/console/auth/otp/verify', { email, code });

export const dangXuat = () => postJson<{ daDangXuat: boolean }>('/v1/console/auth/logout', {});

export const dangXuatMoiThietBi = () =>
  postJson<{ daXoa: number }>('/v1/console/auth/logout-all', {});
